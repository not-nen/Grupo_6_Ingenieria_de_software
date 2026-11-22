# Ingeniería de Software, grupo 6

## INSTRUCCIONES DE ARRANQUE
Con Docker Desktop abierto

Para levantar el proyecto, ejecutar el siguiente comando: `docker compose up --build`

Para detener los contenedores del proyecto, ejecutar el siguiente comando: `docker compose down`. Los datos (usuarios, ayudantías y postulaciones) se conservan en el volumen de la base de datos y vuelven a estar disponibles al levantar el proyecto.

Para borrar la base de datos y empezar desde cero, ejecutar `docker compose down -v` (elimina todos los datos guardados).

### Base de datos online (Neon)
La base de datos está alojada en Neon (Postgres, plan gratuito), proyecto vinculado en el archivo `.neon`. Sus credenciales van en el archivo `.env`, que no se sube a git. Para obtenerlo en otro computador:

1. `npm i -g neon@latest` y `neon login`
2. En la raíz del proyecto: `neon env pull` (escribe `DATABASE_URL` y `DATABASE_URL_UNPOOLED` en `.env`)
3. `docker compose up --build`

Si `.env` no existe o esas variables están vacías, la app usa el Postgres local de Docker (y `docker compose down -v` solo borra esa copia local, no la de Neon). En el plan gratuito, Neon suspende la base tras 5 minutos sin uso; la primera consulta después tarda un poco más.

Para acceder a la página del proyecto, dirigirse a la url `http://localhost:3000` en un navegador web

## INSTRUCCIONES DE USO
Al abrir la página, se llegará a la sección de login. La base de datos incluye estas cuentas de prueba, todas con contraseña `1234`:

| Rol | Nombre | Email |
|---|---|---|
| Estudiante | Estudiante A | estudiante1@gmail.com |
| Estudiante | Estudiante B | estudiante2@gmail.com |
| Profesor | Profesor A | profesor1@gmail.com |
| Profesor | Profesor B | profesor2@gmail.com |
| Administrador | Admin A | admin1@gmail.com |

Los profesores parten sin ramos: el administrador se los asigna desde la sección "Ramos por Profesor" de su panel. Cada rol tiene su propia sesión, por lo que se pueden tener abiertas a la vez las vistas de estudiante, profesor y administrador en el mismo navegador.

También se pueden crear cuentas nuevas desde el registro. Cómo la página asume que los usuarios ya tienen una cuenta usm, no verifica el correo ni la contraseña, por lo que se pueden llenar de cualquier forma. Aún así, se recomienda registrarse con un correo al que se tenga acceso para la vista de estudiantes, para verificar el funcionamiento de la API de correos automáticos.

### Vista de estudiantes
Tiene 2 drop-downs, uno en el que se pueden ver todas las postulaciones realizadas por este estudiante a ayudantías docentes, y otro para las postulaciones a ayudantías administrativas, cada una con un botón de añadir una postulación, además de un botón en la esquina superior derecha, que permitirá visualizar de forma rápida todas las ayudantías disponibles para postulación.

Al hacer click en añadir postulación, se enviará a un formulario en el que se puede buscar distintas ayudantías por sede, además de poder escribir la motivación de ser ayudante de ese ramo y una sección para adjuntar documentos cómo un CV o imagenes. Cuándo se haya terminado de rellenar, hacer click en "Enviar Postulación"

### Vista de profesores
Tiene un dashboard central dónde le aparecen todos los postulantes a los ramos que da cada profesor, teniendo la opción de filtrar y revisar la motivación y archivo adjunto de cada alumno. 

Al seleccionar a un estudiante para una entrevista, este recibe un correo de forma automática, notificándole que fue elegido para tener una entrevista con ese profesor para ese ramo postulado.

### Vista de administradores
Tiene un dashboard central, en dónde tiene 2 drop-downs que le permiten tanto eliminar cómo crear nuevas ayudantías de tipo Administrativas y Docentes por separado. Estos cambios se ven reflejados en la base de datos de forma rápida. 
