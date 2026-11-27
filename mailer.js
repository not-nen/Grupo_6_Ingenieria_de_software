/**
 * Envío de correos.
 * En Railway el SMTP a Gmail (587/465) suele dar ETIMEDOUT (puerto bloqueado).
 * Preferimos API HTTPS (Brevo o Resend). SMTP queda como fallback local.
 */

function smtpUser() {
  return String(process.env.SMTP_USER || "").trim() || null;
}

function smtpPass() {
  const raw = String(process.env.SMTP_PASS || "").trim();
  if (!raw) return null;
  return raw.replace(/\s+/g, "");
}

const user = smtpUser();
const pass = smtpPass();
const brevoKey = String(process.env.BREVO_API_KEY || "").trim() || null;
const resendKey = String(process.env.RESEND_API_KEY || "").trim() || null;

function transporteActivo() {
  if (brevoKey) return "brevo";
  if (resendKey) return "resend";
  if (user && pass) return "smtp";
  return null;
}

const activo = transporteActivo();
if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
  if (!activo || activo === "smtp") {
    console.warn(
      activo === "smtp"
        ? "SMTP Gmail en Railway suele fallar por timeout. Configura BREVO_API_KEY (recomendado) o RESEND_API_KEY."
        : "Sin BREVO_API_KEY/RESEND_API_KEY/SMTP: los correos no se enviarán.",
    );
  } else {
    console.log(`Correo configurado via API ${activo} (from=${user || "default"})`);
  }
} else if (activo) {
  console.log(`Correo configurado via ${activo}`);
}

let smtpTransporter = null;
function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const nodemailer = require("nodemailer");
  const smtpHost = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpSecure =
    process.env.SMTP_SECURE != null
      ? ["1", "true", "yes"].includes(
          String(process.env.SMTP_SECURE).toLowerCase(),
        )
      : smtpPort === 465;
  smtpTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    family: 4,
  });
  return smtpTransporter;
}

async function enviarViaBrevo({ to, subject, text }) {
  const fromEmail = user || "noreply@example.com";
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": brevoKey,
    },
    body: JSON.stringify({
      sender: { name: "Sistema Ayudantías", email: fromEmail },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function enviarViaResend({ to, subject, text }) {
  const fromEmail = user || "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Sistema Ayudantías <${fromEmail}>`,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function enviarViaSmtp({ to, subject, text }) {
  if (!user || !pass) {
    throw new Error("SMTP no configurado (faltan SMTP_USER/SMTP_PASS)");
  }
  await getSmtpTransporter().sendMail({
    from: `"Sistema Ayudantías" <${user}>`,
    to,
    subject,
    text,
  });
}

async function enviar({ to, subject, text }) {
  const modo = transporteActivo();
  if (!modo) {
    throw new Error(
      "Correo no configurado. En Railway usa BREVO_API_KEY (o RESEND_API_KEY).",
    );
  }
  if (modo === "brevo") await enviarViaBrevo({ to, subject, text });
  else if (modo === "resend") await enviarViaResend({ to, subject, text });
  else await enviarViaSmtp({ to, subject, text });
  console.log(`[CORREO ENVIADO via ${modo}] Para: ${to} | Asunto: ${subject}`);
}

async function enviarCorreoSeleccion({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
  nombreProfesor,
}) {
  await enviar({
    to: emailEstudiante,
    subject: `Seleccionado/a para entrevista - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, fuiste seleccionado para una entrevista para la asignatura ` +
      `${asignatura}, con el profesor ${nombreProfesor}, pronto el profesor se contactará con usted ` +
      `para coordinar una hora para la entrevista online.`,
  });
}

async function enviarCorreoAceptacion({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
  nombreProfesor,
}) {
  await enviar({
    to: emailEstudiante,
    subject: `Aceptado/a como ayudante - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, fuiste aceptado/a como ayudante de la asignatura ` +
      `${asignatura}, con el profesor ${nombreProfesor}. Pronto el profesor se contactará con usted ` +
      `para coordinar el inicio de la ayudantía.`,
  });
}

async function enviarCorreoRechazo({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
}) {
  await enviar({
    to: emailEstudiante,
    subject: `Resultado de postulación - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, el proceso de selección de ayudantes para la asignatura ` +
      `${asignatura} ha finalizado y en esta ocasión tu postulación no fue seleccionada. ` +
      `Agradecemos tu interés y te invitamos a postular a futuras ayudantías.`,
  });
}

async function enviarCorreoCierreAceptado({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
}) {
  await enviar({
    to: emailEstudiante,
    subject: `Proceso de selección finalizado - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, el proceso de selección de ayudantes para la asignatura ` +
      `${asignatura} ha finalizado. Te confirmamos que quedaste seleccionado/a como ayudante.`,
  });
}

module.exports = {
  enviarCorreoSeleccion,
  enviarCorreoAceptacion,
  enviarCorreoRechazo,
  enviarCorreoCierreAceptado,
};
