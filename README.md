# Ingeniería de Software, grupo 6

## INSTRUCCIONES DE ARRANQUE
Con Docker Desktop abierto

Para levantar el proyecto, ejecutar el siguiente comando: `docker compose up --build`

Para detener los contenedores del proyecto, ejecutar el siguiente comando: `docker compose down -v`

Para acceder a la página del proyecto, dirigirse a la url `http://localhost:3000` en un navegador web

## INSTRUCCIONES DE USO
Al abrir la página, se llegará a la sección de login, dónde primero se tendrá que crear una cuenta en cada tipo de usuario para acceder a sus respectivas vistas. Cómo la página asume que los usuarios ya tienen una cuenta usm, no verifica el correo ni la contraseña, por lo que se pueden llenar de cualquier forma.

Aún así, se recomienda registrarse con un correo al que se tenga acceso para la vista de estudiantes, para verificar el funcionamiento de la API de correos automáticos. Luego de registrar un tipo de usuario, se accede con el usuario y contraseña registrados.

### Vista de estudiantes
Tiene 2 drop-downs, uno en el que se pueden ver todas las postulaciones realizadas por este estudiante a ayudantías docentes, y otro para las postulaciones a ayudantías administrativas, cada una con un botón de añadir una postulación, además de un botón en la esquina superior derecha, que permitirá visualizar de forma rápida todas las ayudantías disponibles para postulación.

Al hacer click en añadir postulación, se enviará a un formulario en el que se puede buscar distintas ayudantías por sede, además de poder escribir la motivación de ser ayudante de ese ramo y una sección para adjuntar documentos cómo un CV o imagenes. Cuándo se haya terminado de rellenar, hacer click en "Enviar Postulación"

### Vista de profesores
Tiene un dashboard central dónde le aparecen todos los postulantes a los ramos que da cada profesor, teniendo la opción de filtrar y revisar la motivación y archivo adjunto de cada alumno. 

Al seleccionar a un estudiante para una entrevista, este recibe un correo de forma automática, notificándole que fue elegido para tener una entrevista con ese profesor para ese ramo postulado.

### Vista de administradores
Tiene un dashboard central, en dónde tiene 2 drop-downs que le permiten tanto eliminar cómo crear nuevas ayudantías de tipo Administrativas y Docentes por separado. Estos cambios se ven reflejados en la base de datos de forma rápida. 
