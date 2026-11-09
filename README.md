# Acreditaciones del Salón

Sistema de acreditación de ingreso para los eventos del salón.

- Eventos con fecha, hora y sala.
- Lista de invitados (carga manual o importada desde Excel).
- Credencial con código y QR por invitado.
- Acreditación en puerta con lector QR o búsqueda por código, DNI o nombre.
- Contador en vivo, filtros y exportación a CSV.

Publicado como Artifact en claude.ai: https://claude.ai/artifact/CwcHMQhViSm5dQQfT7ghNb

`index.html` usa el runtime de claude.ai (`window.claude`) para la base de datos compartida,
así que la base de datos solo funciona cuando la página está publicada ahí. Si la abrís localmente,
se ve la interfaz pero sin datos.
