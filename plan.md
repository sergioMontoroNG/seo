# Newgarden Shopify SEO Updater

## 1. Objetivo

Construir una aplicación web interna para actualizar de forma masiva determinados campos de productos Shopify a partir de un Excel generado por el proceso SEO de Newgarden.

La aplicación debe sustituir a Matrixify como mecanismo habitual de actualización.

Matrixify debe conservarse únicamente como:

- fallback si falla la actualización GraphQL;
- formato de exportación de emergencia;
- mecanismo adicional de recuperación manual.

El proceso debe ser seguro, auditable y reversible.

Principio fundamental:

**Subir un Excel nunca debe modificar Shopify inmediatamente.**

Siempre debe existir la secuencia:

1. cargar;
2. validar;
3. consultar Shopify;
4. comparar;
5. mostrar preview/dry run;
6. aprobar ejecución;
7. actualizar;
8. verificar;
9. registrar resultado.

---

# 2. Identificación del producto

## 2.1. Campo identificador

El producto debe localizarse usando exclusivamente:

`Slug actual`

Este campo contiene literalmente el handle existente actualmente en Shopify.

Ejemplo:

`macetero-camelia-80`

NO extraer el handle de `URL Actual`.

`URL Actual` debe conservarse únicamente como información contextual para el usuario y para logs.

---

## 2.2. Consulta Shopify

Usar GraphQL Admin API y resolver el producto mediante:

`productByIdentifier`

Conceptualmente:

```graphql
query GetProduct($identifier: ProductIdentifierInput!) {
  product: productByIdentifier(identifier: $identifier) {
    id
    handle
    title
    descriptionHtml
    seo {
      title
      description
    }
  }
}
```

Variables:

```json
{
  "identifier": {
    "handle": "macetero-camelia-80"
  }
}
```

No utilizar `productByHandle` en código nuevo salvo necesidad de compatibilidad.

Una vez localizado el producto, guardar su Shopify GID:

`gid://shopify/Product/...`

Todas las operaciones posteriores de esa ejecución deben realizarse mediante el GID, no mediante el handle.

Esto es obligatorio porque el handle puede modificarse durante la propia ejecución.

---

# 3. Estructura del Excel origen

El sistema debe localizar columnas por el nombre exacto de su encabezado y nunca por posición A/B/C/etc.

Columnas conocidas:

| Excel SEO | Uso |
|---|---|
| URL Actual | Contexto / log |
| Keyword Principal | No actualizar Shopify |
| Keyword relacionadas | No actualizar Shopify |
| Modelo | No actualizar Shopify |
| Fecha de consulta | Contexto / log |
| Slug actual | Identificador Shopify |
| Slug recomendado | Posible nuevo handle |
| Meta Title | SEO title |
| Meta Description | SEO description |
| H1 | Product title |
| Descripción Corta | Metafield |
| Descripción y Características Técnicas | Product descriptionHtml |
| FAQ | Metafield rich text |

La aplicación debe tolerar:

- columnas adicionales;
- distinto orden de columnas;
- futuras columnas no utilizadas.

Debe fallar la validación únicamente si falta una columna requerida para el proceso.

---

# 4. Mapping Shopify

## Campos sin actualización

No escribir en Shopify:

- URL Actual
- Keyword Principal
- Keyword relacionadas
- Modelo
- Fecha de consulta
- Slug actual

`Slug actual` únicamente identifica el producto.

---

## Handle

Origen:

`Slug recomendado`

Destino:

`Product.handle`

Regla:

```text
Slug recomendado == Slug actual
→ no enviar handle

Slug recomendado != Slug actual
→ actualizar handle
→ redirectNewHandle = true
```

No enviar el handle innecesariamente si no ha cambiado.

Antes de ejecutar se deben detectar:

- handles recomendados duplicados dentro del Excel;
- handles recomendados ya ocupados por otro producto Shopify;
- handles inválidos;
- valores vacíos.

Un conflicto de handle debe bloquear únicamente ese producto, no necesariamente toda la ejecución.

---

## H1

Origen:

`H1`

Destino:

`Product.title`

---

## Meta Title

Origen:

`Meta Title`

Destino:

`Product.seo.title`

No reproducir internamente la nomenclatura Matrixify:

`Metafield: title_tag [string]`

GraphQL debe tratarlo mediante el SEO nativo del producto.

---

## Meta Description

Origen:

`Meta Description`

Destino:

`Product.seo.description`

---

## Descripción y Características Técnicas

Origen:

`Descripción y Características Técnicas`

Destino:

`Product.descriptionHtml`

El contenido debe preservarse como HTML.

No escapar el HTML convirtiéndolo en texto plano.

---

## Descripción Corta

Origen:

`Descripción Corta`

Destino:

Metafield:

```text
namespace: custom
key: descripcion_corta
type: multi_line_text_field
```

---

## FAQ

Origen:

`FAQ`

Destino:

Metafield:

```text
namespace: newgarden
key: faq
type: rich_text_field
```

Este campo necesita un adaptador específico.

No asumir que el contenido del Excel puede enviarse directamente.

Antes de implementar la escritura:

1. consultar la definición real del metafield en la tienda;
2. consultar uno o más productos que ya tengan FAQ válido;
3. estudiar el formato de entrada procedente del Excel;
4. transformar el contenido al JSON rich text requerido por Shopify;
5. validar la transformación antes de habilitar escrituras.

El parser de FAQ debe estar aislado en un módulo independiente.

Ejemplo conceptual:

```text
Excel FAQ
   ↓
FaqParser
   ↓
Shopify Rich Text JSON
   ↓
GraphQL
```

---

# 5. Política de celdas vacías

Comportamiento predeterminado:

```text
celda vacía
→ NO modificar Shopify
```

Una ausencia de dato nunca debe interpretarse automáticamente como una orden de borrado.

Esto aplica a:

- H1;
- Meta Title;
- Meta Description;
- descripción;
- descripción corta;
- FAQ;
- slug recomendado.

Preparar internamente el motor para soportar en el futuro una orden explícita de borrado, pero no es necesario exponerla en V1.

Ejemplo futuro:

`__BORRAR__`

No implementarlo automáticamente si no está expresamente habilitado.

---

# 6. Lectura del estado actual de Shopify

El dry run debe consultar los valores actuales necesarios para comparar:

- Product ID;
- handle;
- title;
- descriptionHtml;
- seo.title;
- seo.description;
- `custom.descripcion_corta`;
- `newgarden.faq`.

No se debe considerar un campo como cambio simplemente porque aparezca en el Excel.

Debe compararse:

```text
valor actual Shopify
vs
valor propuesto Excel
```

Clasificación de cada campo:

- `UNCHANGED`
- `CHANGE`
- `EMPTY_SOURCE`
- `INVALID`
- `ERROR`

Esto permitirá enviar a Shopify exclusivamente los campos que realmente cambian.

---

# 7. Modelo de procesamiento

Cada fila del Excel debe convertirse primero a un objeto interno independiente de Excel y Shopify.

Ejemplo conceptual:

```typescript
interface SourceProduct {
  rowNumber: number;

  urlActual?: string;
  fechaConsulta?: string;

  currentHandle: string;
  recommendedHandle?: string;

  title?: string;
  seoTitle?: string;
  seoDescription?: string;
  descriptionHtml?: string;
  shortDescription?: string;
  faqRaw?: string;
}
```

Posteriormente:

```typescript
interface ShopifySnapshot {
  productId: string;

  handle: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  descriptionHtml: string;
  shortDescription: string | null;
  faqRawValue: string | null;
}
```

Y finalmente:

```typescript
interface ProductChangeSet {
  productId: string;
  sourceRow: number;

  before: ShopifySnapshot;
  proposed: SourceProduct;

  changes: FieldChange[];
  status:
    | "READY"
    | "NO_CHANGES"
    | "WARNING"
    | "BLOCKED";
}
```

Excel no debe contaminar la capa GraphQL.

---

# 8. Fases de una ejecución

## Fase 1 — Upload

El usuario selecciona:

- tienda;
- fichero `.xlsx`.

La aplicación crea un `Run`.

Estado inicial:

`UPLOADED`

Guardar una copia del Excel original asociada a la ejecución.

---

## Fase 2 — Validación estructural

Comprobar:

- fichero XLSX válido;
- hoja válida;
- encabezados requeridos;
- `Slug actual` no vacío;
- duplicados de `Slug actual`;
- filas completamente vacías;
- tipos básicos;
- handles recomendados duplicados.

Resultado:

`VALIDATING`

y posteriormente:

`VALIDATED`

o:

`VALIDATION_FAILED`

No consultar Shopify si la estructura básica no es válida.

---

# 9. Dry run

Tras validar el fichero:

1. recorrer las filas;
2. resolver cada producto usando `Slug actual`;
3. obtener Product GID;
4. obtener estado actual;
5. transformar valores;
6. comparar;
7. calcular cambios;
8. detectar errores y warnings;
9. almacenar snapshot;
10. no escribir absolutamente nada.

Estado:

`ANALYZED`

---

# 10. Preview web

Mostrar resumen global:

```text
Productos Excel                 325

Encontrados                     319
No encontrados                    6

Con cambios                     281
Sin cambios                      38
Bloqueados                        4

Handle                           32
Title                           147
SEO Title                       250
SEO Description                 261
Description HTML                210
Descripción corta               184
FAQ                             173
```

Permitir filtrar por:

- todos;
- con cambios;
- sin cambios;
- warnings;
- errores;
- cambio de handle.

---

## Detalle por producto

Mostrar:

### Identificación

- fila Excel;
- URL Actual;
- Slug actual;
- Shopify Product ID.

### Cambios

Formato:

```text
TITLE

ANTES
Macetero Camelia

DESPUÉS
Macetero Camelia 80 para exterior
```

Para Handle:

```text
HANDLE

ANTES
camelia-80

DESPUÉS
macetero-camelia-80

✓ Se creará redirección
```

Cada producto debe poder:

- incluirse;
- excluirse de la ejecución.

Idealmente permitir también exclusión por campo, pero puede quedar para V2.

---

# 11. Ejecución

Al pulsar:

`Aplicar cambios`

crear una ejecución inmutable basada en el snapshot analizado.

No volver a interpretar el Excel durante la escritura.

Procesar producto a producto.

Para cada producto:

1. usar Product GID obtenido durante análisis;
2. construir ProductUpdateInput solo con campos modificados;
3. ejecutar GraphQL;
4. inspeccionar errores HTTP/GraphQL;
5. inspeccionar `userErrors`;
6. guardar resultado;
7. continuar con el siguiente producto.

La actualización de un producto no debe detener el lote completo salvo error global de autenticación/configuración.

---

# 12. Mutation principal

Usar:

`productUpdate`

Shopify permite actualizar mediante `ProductUpdateInput`, entre otros, `title`, `handle`, `descriptionHtml`, `seo`, `metafields` y `redirectNewHandle`.

Construir dinámicamente el input.

Ejemplo conceptual:

```json
{
  "id": "gid://shopify/Product/123456789",
  "title": "Nuevo H1",
  "handle": "nuevo-handle",
  "redirectNewHandle": true,
  "descriptionHtml": "<p>...</p>",
  "seo": {
    "title": "...",
    "description": "..."
  },
  "metafields": [
    {
      "namespace": "custom",
      "key": "descripcion_corta",
      "type": "multi_line_text_field",
      "value": "..."
    }
  ]
}
```

NO incluir propiedades que no han cambiado.

Siempre procesar:

`userErrors`

aunque la respuesta HTTP sea 200.

---

# 13. Handles y redirecciones

Si cambia el handle, enviar:

```text
redirectNewHandle = true
```

La intención es que Shopify cree automáticamente la redirección del handle anterior al nuevo.

Antes de hacerlo:

1. comprobar que el slug recomendado es válido;
2. comprobar que no está ocupado;
3. comprobar que no está duplicado en el lote.

Una vez resuelto el producto por `Slug actual`, el resto de la ejecución debe depender del GID.

Nunca intentar buscarlo posteriormente por el handle antiguo.

---

# 14. Verificación posterior

Después de un `productUpdate` correcto:

realizar una lectura de verificación o comprobar suficientemente la respuesta de la mutation.

Para campos críticos se recomienda lectura posterior:

- handle;
- title;
- SEO;
- metafields.

Registrar:

```text
REQUESTED
UPDATED
VERIFIED
```

Si GraphQL responde correctamente pero la comprobación posterior no coincide:

`VERIFICATION_FAILED`

---

# 15. Rollback

Toda ejecución debe almacenar el estado anterior.

Como mínimo:

```text
handle
title
seo.title
seo.description
descriptionHtml
descripcion_corta
faq
```

Modelo:

```text
Run
 └── RunProduct
      ├── before
      ├── requested
      ├── after
      └── status
```

La aplicación debe permitir:

`Revertir ejecución`

El rollback debe ser otra ejecución normal, no una modificación directa de la base de datos.

Debe reutilizar el mismo motor GraphQL.

Conceptualmente:

```text
Run #42
ANTES A
DESPUÉS B

Rollback #43
ANTES B
DESPUÉS A
```

Así se mantiene historial completo.

Advertencia:

si han existido modificaciones posteriores en Shopify, el sistema debe detectar que el estado actual ya no coincide con el `after` del Run original y advertir antes de sobrescribir.

---

# 16. Control de concurrencia

Entre el dry run y la ejecución puede cambiar Shopify.

Por ello, antes de escribir cada producto, comparar al menos los campos que se van a modificar con el snapshot utilizado para el preview.

Si:

```text
actual Shopify != snapshot before
```

marcar:

`STALE_DATA`

y no actualizar automáticamente ese producto.

Esto evita pisar cambios manuales producidos mientras el Excel estaba pendiente de aprobación.

---

# 17. Matrixify fallback

El sistema debe compartir una única lógica de mapping.

No implementar:

```text
Motor GraphQL
Motor Matrixify
```

por separado.

Debe existir:

```text
Excel SEO
    ↓
Normalizer
    ↓
ChangeSet
    ├── GraphQLWriter
    └── MatrixifyExporter
```

El botón:

`Exportar Matrixify`

debe generar un XLSX utilizando los cambios ya validados.

De esta forma GraphQL y Matrixify producen exactamente la misma intención de actualización.

Matrixify no debe participar en el proceso normal de resolución del producto.

---

# 18. Histórico

Pantalla de ejecuciones:

```text
#58  30/09/2026  ES  COMPLETED
325 productos · 281 modificados · 4 errores

#57  28/09/2026  ES  ROLLED_BACK
...
```

Detalle:

- usuario;
- fecha;
- tienda;
- fichero original;
- nº de filas;
- encontrados;
- modificados;
- omitidos;
- errores;
- cambios de handle;
- duración;
- rollback relacionado.

---

# 19. Base de datos

Usar PostgreSQL.

Entidades mínimas:

## Store

```text
id
code
name
shopDomain
enabled
```

No almacenar access token sin cifrar en una columna normal.

Preferiblemente obtener credenciales mediante variables de entorno/secrets.

---

## Run

```text
id
storeId
filename
status
createdAt
analyzedAt
executedAt
createdBy
totalRows
```

---

## RunProduct

```text
id
runId
rowNumber
productId
currentHandle
recommendedHandle
urlActual

status

beforeJson
proposedJson
afterJson
changesJson
errorsJson
```

Los JSON permiten conservar exactamente qué ocurrió aunque posteriormente cambie el esquema funcional.

---

# 20. Arquitectura propuesta

Mantenerla sencilla.

```text
Browser
   │
   ▼
Web App
   │
   ├── Excel Parser
   ├── Validation Engine
   ├── Diff Engine
   ├── FAQ Transformer
   ├── Shopify Client
   ├── Matrixify Exporter
   └── Run Service
           │
           ├── PostgreSQL
           └── Shopify GraphQL
```

Stack recomendado:

```text
TypeScript
React
Node.js
PostgreSQL
Docker
```

Puede utilizarse un framework full-stack TypeScript si simplifica despliegue y mantenimiento.

No crear microservicios.

Es una aplicación interna y el volumen no justifica arquitectura distribuida inicialmente.

---

# 21. Despliegue

Desplegar como contenedor Docker en la infraestructura existente.

Ejemplo:

`seo.apps.newgarden.es`

Componentes:

```text
reverse proxy
    ↓
web app
    ↓
PostgreSQL
```

El servicio no debe exponerse públicamente sin autenticación.

---

# 22. Seguridad

Los tokens Shopify:

- solo existen en backend;
- nunca aparecen en JavaScript del navegador;
- nunca se guardan en el Excel;
- nunca se escriben en logs;
- nunca se devuelven por endpoints API.

Scopes mínimos a estudiar:

```text
read_products
write_products
```

La consulta del producto necesita lectura y `productUpdate` necesita `write_products`.

Mantener principio de mínimo privilegio.

---

# 23. Configuración multitienda

Aunque V1 puede comenzar únicamente con ES, no hardcodear la tienda.

Diseño:

```text
stores:
  ES:
    shopDomain: ...
    tokenSecret: SHOPIFY_ES_TOKEN

  FR:
    ...

  DE:
    ...
```

Toda ejecución pertenece a una tienda concreta.

Nunca permitir que una ejecución cambie de tienda después del análisis.

---

# 24. Rate limits y ejecución

Implementar un Shopify GraphQL client centralizado.

Responsabilidades:

- autenticación;
- API version;
- retries;
- throttle handling;
- logging técnico;
- normalización de errores.

No lanzar cientos de mutations simultáneamente.

V1 puede trabajar con concurrencia muy baja, incluso secuencial.

Priorizar fiabilidad frente a velocidad.

Preparar el cliente para leer la información de coste/throttle devuelta por GraphQL y esperar/reintentar cuando corresponda.

---

# 25. API Shopify versionada

No utilizar:

`unstable`

Fijar explícitamente una versión soportada de Admin API en configuración.

Por ejemplo:

```text
SHOPIFY_API_VERSION=2026-07
```

Antes de implementar, comprobar qué versión estable está vigente en ese momento y fijarla.

Nunca depender de `latest` en producción.

---

# 26. Comparación de textos

Crear funciones de comparación específicas.

No usar indiscriminadamente:

```typescript
oldValue.trim() === newValue.trim()
```

para todos los campos.

Por ejemplo:

### Handle

comparación exacta normalizada.

### Title / SEO

puede normalizarse CRLF/LF y espacios finales.

### HTML

tener cuidado con HTML semánticamente igual pero serializado de forma diferente.

### Rich text

comparar estructura normalizada, no necesariamente el JSON string byte a byte.

El motor debe evitar escrituras innecesarias.

---

# 27. Logging

Nunca loggear tokens.

Para cada petición registrar:

```text
runId
productId
operation
timestamp
result
userErrors
duration
```

No es necesario registrar el contenido completo de descripciones en logs técnicos porque ya queda almacenado en el snapshot de la ejecución.

---

# 28. Estados

## Run

```text
UPLOADED
VALIDATING
VALIDATION_FAILED
VALIDATED
ANALYZING
ANALYZED
EXECUTING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
ROLLED_BACK
```

## RunProduct

```text
PENDING
NOT_FOUND
NO_CHANGES
READY
EXCLUDED
BLOCKED
UPDATING
UPDATED
VERIFIED
ERROR
STALE_DATA
```

---

# 29. Tratamiento de errores

## Producto no encontrado

```text
Slug actual → no existe Shopify
```

Resultado:

`NOT_FOUND`

No intentar localizar automáticamente por:

- URL Actual;
- Slug recomendado;
- title;
- SKU.

La aplicación debe evitar heurísticas que puedan actualizar el producto equivocado.

---

## Producto encontrado pero handle Shopify distinto

Dado que se ha buscado por handle, esta situación normalmente indica inconsistencia.

Registrar y bloquear.

---

## Error de una mutation

Registrar `userErrors`.

Continuar con el siguiente producto.

---

## Error de autenticación

Detener la ejecución global.

---

## Rate limit

Esperar/reintentar mediante el Shopify Client.

No marcar el producto como error inmediatamente.

---

# 30. Validaciones obligatorias antes de permitir ejecutar

La interfaz no debe habilitar `Aplicar cambios` mientras existan errores globales.

Validar al menos:

- estructura del Excel;
- columnas requeridas;
- tienda configurada;
- conexión Shopify;
- Slug actual;
- duplicados Slug actual;
- duplicados Slug recomendado;
- productos encontrados;
- handles recomendados válidos;
- conflictos de handle;
- transformación FAQ;
- definición de metafields.

---

# 31. Metafield definitions

Durante inicialización de una tienda o mediante herramienta de diagnóstico, comprobar que existen las definiciones:

```text
custom.descripcion_corta
newgarden.faq
```

y que sus tipos son:

```text
multi_line_text_field
rich_text_field
```

Si no coinciden:

bloquear la ejecución para ese campo.

No intentar cambiar automáticamente las definiciones.

---

# 32. UX mínima V1

## Página principal

```text
NEWGARDEN SEO UPDATER

Tienda
[ España ▼ ]

Archivo
[ SEO_30_09_2026.xlsx ]

[ Analizar ]
```

---

## Resultado análisis

```text
325 productos
281 con cambios
38 sin cambios
6 no encontrados
4 bloqueados

[Ver todos]
[Errores]
[Cambios de URL]

[Exportar Matrixify]
[Aplicar cambios]
```

---

## Ejecución

Mostrar progreso:

```text
125 / 281

Correctos  121
Errores      2
Omitidos     2
```

No hace falta implementar WebSockets en V1 si polling simple resulta suficiente.

---

# 33. Tests obligatorios

## Unitarios

Probar:

- parser Excel;
- detección de columnas;
- normalización de handle;
- diff;
- política de vacíos;
- transformación FAQ;
- construcción ProductUpdateInput;
- export Matrixify.

---

## Integración

Tienda Shopify de desarrollo/test.

Casos:

1. producto sin cambios;
2. solo Title;
3. solo SEO;
4. descripción HTML;
5. descripción corta;
6. FAQ;
7. cambio de handle;
8. redirección;
9. producto inexistente;
10. handle recomendado ocupado;
11. celda vacía;
12. varios campos simultáneamente;
13. `userErrors`;
14. rollback;
15. stale data.

---

# 34. Caso crítico de cambio de handle

Test obligatorio:

Estado inicial:

```text
Slug actual:
camelia-80

Slug recomendado:
macetero-camelia-80
```

Proceso esperado:

```text
1. productByIdentifier(handle: "camelia-80")
2. obtener Product GID
3. guardar snapshot
4. preview
5. productUpdate(
     id = Product GID,
     handle = "macetero-camelia-80",
     redirectNewHandle = true
   )
6. verificar nuevo handle
7. marcar VERIFIED
```

En ningún punto se debe volver a necesitar:

`camelia-80`

para identificar el producto tras obtener el GID.

---

# 35. Criterios de aceptación de V1

La V1 estará terminada cuando pueda:

1. recibir el Excel SEO;
2. detectar columnas por encabezado;
3. localizar productos mediante `Slug actual`;
4. obtener Product GID;
5. comparar Shopify contra Excel;
6. mostrar dry run;
7. detectar productos inexistentes;
8. detectar conflictos de handle;
9. actualizar Handle;
10. crear redirect al cambiar Handle;
11. actualizar H1;
12. actualizar Meta Title;
13. actualizar Meta Description;
14. actualizar descripción HTML;
15. actualizar descripción corta;
16. actualizar FAQ correctamente;
17. ignorar celdas vacías;
18. actualizar solo campos realmente modificados;
19. guardar estado anterior;
20. guardar resultado;
21. verificar cambios;
22. mostrar errores individualmente;
23. generar XLSX Matrixify de fallback;
24. consultar histórico;
25. revertir una ejecución.

---

# 36. Fuera de alcance de V1

No implementar inicialmente:

- generación SEO mediante IA;
- edición manual avanzada de contenido;
- actualización de variantes;
- imágenes;
- precios;
- inventario;
- colecciones;
- traducción automática entre tiendas;
- sincronización automática multitienda;
- colas distribuidas;
- Kubernetes;
- microservicios;
- scheduling;
- ejecución automática al recibir un fichero.

Primero conseguir un pipeline de actualización de producto fiable y auditable.

---

# 37. Orden recomendado de implementación

## Etapa 1 — Shopify spike

Crear un script aislado que:

- conecte con la tienda de pruebas;
- busque por `Slug actual` mediante `productByIdentifier`;
- lea todos los campos necesarios;
- actualice un producto;
- pruebe cambio de handle;
- pruebe redirect;
- pruebe ambos metafields;
- determine exactamente el formato FAQ.

No continuar hasta validar esto.

---

## Etapa 2 — Excel

Implementar:

- parser;
- mapping;
- validaciones;
- modelo interno.

Sin UI.

---

## Etapa 3 — Diff engine

Construir:

```text
SourceProduct + ShopifySnapshot
             ↓
       ProductChangeSet
```

Añadir tests.

---

## Etapa 4 — Ejecutor

Implementar:

- ProductUpdateInput builder;
- Shopify client;
- estados;
- retry;
- verification.

---

## Etapa 5 — Persistencia

Añadir:

- PostgreSQL;
- runs;
- snapshots;
- resultados.

---

## Etapa 6 — Web UI

Añadir:

- upload;
- análisis;
- preview;
- filtros;
- ejecución;
- histórico.

---

## Etapa 7 — Rollback

Implementar reversión usando snapshots.

---

## Etapa 8 — Matrixify fallback

Generar XLSX a partir del mismo ChangeSet.

---

## Etapa 9 — Docker y producción

Añadir:

- Dockerfile;
- compose;
- variables de entorno;
- reverse proxy;
- autenticación;
- backups DB;
- healthcheck.

---

# 38. Principio de diseño principal

El núcleo del proyecto NO debe ser Shopify ni Excel.

Debe ser este modelo:

```text
           Excel
             │
             ▼
        Normalización
             │
             ▼
Shopify → ChangeSet
             │
       ┌─────┴─────┐
       ▼           ▼
    GraphQL     Matrixify
```

`ChangeSet` representa la intención exacta de cambio.

Esto permitirá cambiar:

- estructura del Excel;
- columnas;
- método de importación;
- tienda;
- frontend;

sin reescribir la lógica de negocio.

---

# 39. Regla esencial que no debe modificarse

**`Slug actual` identifica el producto.**

No:

```text
URL Actual → extraer handle
```

Sí:

```text
Slug actual
     ↓
productByIdentifier(handle)
     ↓
Product GID
     ↓
toda la operación utiliza Product GID
```

`URL Actual` es únicamente información auxiliar.

---

# 40. Prioridad del proyecto

Prioridades, en este orden:

```text
1. No actualizar productos incorrectos
2. Poder saber exactamente qué se cambió
3. Poder revertirlo
4. Validar antes de escribir
5. No perder contenido existente por celdas vacías
6. Continuar ante errores aislados
7. Facilidad de uso
8. Velocidad
```

Nunca sacrificar los puntos 1–6 para hacer el procesamiento más rápido.
