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

module.exports = { enviarCorreoSeleccion };
