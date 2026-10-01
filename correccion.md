# 21. Despliegue interno

La aplicación es exclusivamente una herramienta interna de Newgarden.

NO debe publicarse mediante:

- dominio público;
- subdominio;
- reverse proxy público;
- Vercel;
- Cloudflare Tunnel;
- exposición directa a Internet.

Debe desplegarse dentro de la red local y accederse mediante la IP privada del servidor.

Ejemplo:

```text
http://192.168.x.x:3000
```

La IP y el puerto concretos deben configurarse durante el despliegue.

Arquitectura:

```text
PCs red interna Newgarden
          │
          │ LAN
          ▼
   192.168.x.x:PUERTO
          │
          ▼
┌─────────────────────────┐
│ Servidor / VM interna   │
│                         │
│  Web App                │
│  Backend                │
│  PostgreSQL             │
└───────────┬─────────────┘
            │
            │ HTTPS saliente
            ▼
   Shopify Admin API
```

El navegador nunca se comunica directamente con Shopify.

El flujo debe ser:

```text
Navegador
   ↓
Backend interno
   ↓
Shopify GraphQL
```

Los tokens de Shopify permanecen exclusivamente en el servidor.

## Bind de red

El servicio web debe escuchar en una interfaz accesible desde la LAN.

Por ejemplo:

```text
0.0.0.0:3000
```

si el firewall del servidor limita correctamente el acceso a la red interna.

No configurar el servidor para aceptar conexiones entrantes desde Internet.

## Firewall

Permitir conexiones al puerto de la aplicación únicamente desde:

- la subred corporativa;
- o las subredes internas autorizadas.

Ejemplo conceptual:

```text
192.168.0.0/16 → puerto aplicación → permitido
Internet → puerto aplicación → bloqueado
```

Adaptar las reglas al direccionamiento real de Newgarden.

## Acceso a Shopify

Aunque la aplicación no sea accesible desde Internet, el servidor necesita conectividad HTTPS saliente hacia Shopify para utilizar Admin GraphQL API.

Por tanto:

```text
Internet → aplicación
BLOQUEADO

Aplicación → Shopify
PERMITIDO
```

No es necesario abrir ningún puerto entrante para que GraphQL funcione.

## Docker

Puede desplegarse mediante Docker Compose:

```text
seo-updater-app
postgres
```

No es necesario añadir Nginx, Traefik o ningún reverse proxy salvo que exista posteriormente una necesidad interna concreta.

El acceso puede realizarse directamente contra el puerto publicado por el contenedor:

```text
192.168.x.x:3000
```

## Persistencia

La base de datos y los ficheros necesarios deben utilizar volúmenes persistentes.

Como mínimo conservar:

- PostgreSQL;
- Excels originales de cada ejecución;
- exports Matrixify generados;
- logs necesarios;
- configuración persistente que no sean secretos.

## Secrets

Los tokens de Shopify deben mantenerse mediante:

- variables de entorno del servidor;
- fichero `.env` no versionado;
- o mecanismo equivalente de secretos.

Nunca incluir tokens en Git.

## Autenticación interna

Aunque la aplicación solo sea accesible desde la LAN, no asumir que estar en la red equivale necesariamente a estar autorizado.

La V1 puede utilizar autenticación interna simple si se considera necesaria.

No obstante, la aplicación no necesita implementar OAuth público de Shopify ni un flujo de instalación estilo Shopify App Store.

Las credenciales de cada tienda pueden configurarse directamente en el backend, ya que se trata de una integración interna controlada.

## URL de acceso

No asumir ningún hostname público.

La configuración debe permitir algo como:

```env
HOST=0.0.0.0
PORT=3000
```

El usuario accederá mediante:

```text
http://192.168.x.x:3000
```

o mediante un nombre DNS interno si Newgarden decidiera configurarlo posteriormente.

## Healthcheck

Exponer internamente un endpoint:

```text
/health
```

que permita comprobar:

- aplicación activa;
- conexión a PostgreSQL;
- opcionalmente configuración básica disponible.

No debe mostrar tokens ni información sensible.

## Backup

Incluir backup periódico de PostgreSQL.

Los snapshots de ejecuciones son especialmente importantes porque constituyen la base del sistema de rollback.

La pérdida de la base de datos implicaría perder:

- histórico;
- estado anterior;
- trazabilidad;
- capacidad de rollback.

Por ello, la base de datos debe considerarse persistencia crítica.
