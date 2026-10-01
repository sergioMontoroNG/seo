# Newgarden Shopify SEO Updater

Aplicación interna para revisar y actualizar campos SEO de productos. El navegador solo habla con este backend; las credenciales Shopify viven como variables de entorno del servidor. La aplicación escucha en `0.0.0.0:3030`; publicar el puerto únicamente en la LAN y limitar el firewall a las subredes corporativas. No configurar DNS público, túnel ni proxy público.

## Puesta en marcha

1. Copiar `.env.example` a `.env`, establecer `POSTGRES_PASSWORD` (contraseña aleatoria con caracteres URL-safe) y `STORES_JSON`. Compose construye `DATABASE_URL` con el mismo `POSTGRES_PASSWORD`, así el secreto de PostgreSQL y el del backend no se desincronizan. Ejemplo: `STORES_JSON={"ES":{"name":"España","domain":"tienda.myshopify.com","token_env":"SHOPIFY_ES_TOKEN"}}`.
2. Añadir `SHOPIFY_ES_TOKEN` al `.env`; usar un token Admin API con `read_products` y `write_products`. El secreto no se almacena en la base de datos ni se envía al navegador.
3. Ajustar `PORT` y `HOST` según la infraestructura interna. Configurar el firewall del host para permitir el puerto solamente desde las redes autorizadas y bloquear conexiones entrantes desde Internet. El servidor necesita HTTPS saliente a Shopify.
4. Ejecutar `docker compose up -d --build`; acceder desde la LAN como `http://IP_PRIVADA:3000`.
5. Revisar `/health`. Protege el acceso con `AUTH_USER`/`AUTH_PASSWORD` o controles de red corporativos.
6. Programar `scripts/backup-postgres.sh` a diario y conservar también el volumen `seo_data` (Excels originales). Guardar los backups fuera del host.

`docker-compose.yml` no instala reverse proxy y publica directamente el puerto indicado. En redes compartidas es recomendable establecer autenticación interna y reglas de firewall de host/router.

## Flujo de uso

Seleccionar tienda y XLSX, analizar el preview, excluir filas si hace falta, exportar Matrixify o ejecutar. La ejecución usa snapshots, compara el estado inmediatamente antes de escribir, actualiza por GID y verifica la lectura posterior. Los fallos de una fila se registran y no detienen las demás. El histórico permite crear un nuevo run de rollback, sujeto a la comprobación de datos obsoletos.

La tabla muestra resúmenes compactos. Desplegar los cambios de un producto y después cada campo permite comparar el texto completo actual y propuesto, con altura limitada y desplazamiento. La identificación y las incidencias también se pueden desplegar. Los controles admiten navegación con teclado y foco visible; los avisos se anuncian a lectores de pantalla. Durante una ejecución se conservan los detalles abiertos, el foco y la posición de lectura al actualizar el progreso.

## FAQ

El metafield `newgarden.faq` es `rich_text_field`. `app/faq_parser.py` convierte el pseudo HTML de Newgarden (`<h2>`, `<h3>` y texto de párrafo) en JSON rich text, respetando la estructura observada en metafields existentes de la tienda: encabezados como hijos directos de `root` y respuestas como párrafos. También acepta JSON rich text existente para facilitar una reversión. El analizador confirma la definición `rich_text_field` de la tienda antes de comparar y bloqueará FAQ si falta o tiene otro tipo. FAQ está habilitado en `.env.example`; se puede desactivar con `FAQ_WRITES_ENABLED=false` para diagnosticar una tienda.

## Persistencia y operación

PostgreSQL conserva ejecuciones, cambios antes/después y resultados. Los XLSX originales se guardan en el volumen `/data`. Las credenciales no se incluyen en la imagen. La versión Shopify se fija mediante `SHOPIFY_API_VERSION` y no se usa `unstable`.
