const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Envía el correo de notificación de entrevista al estudiante seleccionado.
 */
async function enviarCorreoSeleccion({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
  nombreProfesor,
}) {
  await transporter.sendMail({
    from: `"Sistema Ayudantías" <${process.env.SMTP_USER}>`,
    to: emailEstudiante,
    subject: `Seleccionado/a para entrevista - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, fuiste seleccionado para una entrevista para la asignatura ` +
      `${asignatura}, con el profesor ${nombreProfesor}, pronto el profesor se contactará con usted ` +
      `para coordinar una hora para la entrevista online.`,
  });

  console.log(
    `[CORREO ENVIADO] Para: ${emailEstudiante} | Asunto: Seleccionado/a para entrevista - ${asignatura}`,
  );
}

/**
 * Envía el correo de aceptación al estudiante elegido como ayudante.
 */
async function enviarCorreoAceptacion({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
  nombreProfesor,
}) {
  await transporter.sendMail({
    from: `"Sistema Ayudantías" <${process.env.SMTP_USER}>`,
    to: emailEstudiante,
    subject: `Aceptado/a como ayudante - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, fuiste aceptado/a como ayudante de la asignatura ` +
      `${asignatura}, con el profesor ${nombreProfesor}. Pronto el profesor se contactará con usted ` +
      `para coordinar el inicio de la ayudantía.`,
  });

  console.log(
    `[CORREO ENVIADO] Para: ${emailEstudiante} | Asunto: Aceptado/a como ayudante - ${asignatura}`,
  );
}

/**
 * Envía el correo de rechazo; solo se usa cuando el profesor cierra el proceso de selección.
 */
async function enviarCorreoRechazo({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
}) {
  await transporter.sendMail({
    from: `"Sistema Ayudantías" <${process.env.SMTP_USER}>`,
    to: emailEstudiante,
    subject: `Resultado de postulación - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, el proceso de selección de ayudantes para la asignatura ` +
      `${asignatura} ha finalizado y en esta ocasión tu postulación no fue seleccionada. ` +
      `Agradecemos tu interés y te invitamos a postular a futuras ayudantías.`,
  });

  console.log(
    `[CORREO ENVIADO] Para: ${emailEstudiante} | Asunto: Resultado de postulación - ${asignatura}`,
  );
}

/**
 * Avisa a un ayudante aceptado que el proceso de selección del ramo terminó.
 */
async function enviarCorreoCierreAceptado({
  nombreEstudiante,
  emailEstudiante,
  asignatura,
}) {
  await transporter.sendMail({
    from: `"Sistema Ayudantías" <${process.env.SMTP_USER}>`,
    to: emailEstudiante,
    subject: `Proceso de selección finalizado - ${asignatura}`,
    text:
      `Estimado/a ${nombreEstudiante}, el proceso de selección de ayudantes para la asignatura ` +
      `${asignatura} ha finalizado. Te confirmamos que quedaste seleccionado/a como ayudante.`,
  });

  console.log(
    `[CORREO ENVIADO] Para: ${emailEstudiante} | Asunto: Proceso de selección finalizado - ${asignatura}`,
  );
}

module.exports = {
  enviarCorreoSeleccion,
  enviarCorreoAceptacion,
  enviarCorreoRechazo,
  enviarCorreoCierreAceptado,
};
