# Resumen diario en Notion

Una página nueva por día en una base de datos de Notion: qué se entregó, qué no
salió, cuánto llevó cada chofer, y qué quedó pendiente con nombre y apellido.

**Todo esto está inerte hasta que existan las dos variables de abajo.** Sin
ellas no hay error ni intento: la app sigue igual.

---

## 1. Crear la integración (2 minutos)

1. Entra a <https://www.notion.so/my-integrations> → **New integration**.
2. Ponle un nombre (por ejemplo `RDZ Deliveries`) y elige tu espacio de trabajo.
3. Copia el **Internal Integration Secret**. Empieza con `ntn_` o `secret_`.

## 2. Crear la base de datos y compartirla

1. En Notion, crea una página nueva y adentro una **base de datos** (tabla).
   **No necesita columnas especiales** — con el título le basta; el detalle va
   en el cuerpo de cada página.
2. Abre la base de datos, botón **⋯** arriba a la derecha → **Connections** →
   **Connect to** → elige tu integración.

   Este paso es el que más se olvida. Sin él la API responde
   *"Could not find database"* aunque el token sea correcto.

3. Copia el **ID de la base de datos** de la URL. En
   `notion.so/miespacio/`**`a8aec43384f447ed84390e8e42c2e089`**`?v=...`
   el ID es la parte en negritas (32 caracteres).

   Ojo: tiene que ser la URL de la **base de datos**, no la de una página
   dentro de ella.

## 3. Guardar las llaves en Vercel

En **Vercel → el proyecto → Settings → Environment Variables**:

| Nombre | Valor |
|---|---|
| `NOTION_TOKEN` | el secreto del paso 1 |
| `NOTION_DATABASE_ID` | el ID del paso 2 |
| `CRON_SECRET` | cualquier texto largo al azar |

`CRON_SECRET` es lo que prueba que quien dispara el resumen es la tarea
programada de Vercel y no alguien que adivinó la URL. Vercel lo manda solo en
cada ejecución.

Luego **Redeploy**.

## 4. Probarlo

Estando firmado como admin, abre en el navegador:

```
/api/notion-summary
```

Devuelve la URL de la página que creó en Notion. Para rehacer un día pasado:

```
/api/notion-summary?date=2026-08-17
```

## Cuándo corre solo

Todos los días a la **01:00 UTC** — 20:00 hora del Valle en horario de verano,
19:00 en invierno. Las tareas programadas de Vercel solo aceptan UTC, así que
esa hora se recorre sola cuando cambia el horario; en ambos casos cae después
de la última entrega del día.

Se cambia en `vercel.json`.
