# Resumen diario en Notion

Una página nueva por día en una base de datos de Notion: qué se entregó, qué no
salió, cuánto llevó cada chofer, y qué quedó pendiente con nombre y apellido.

**Todo esto está inerte hasta que existan las dos variables de abajo.** Sin
ellas no hay error ni intento: la app sigue igual.

---

## 1. Crear el token (2 minutos)

Notion renombró esta parte: ya no se llama "integration", ahora son **Personal
access tokens** / **Connections**.

1. Entra a <https://www.notion.so/developers> → **Personal access tokens**.
2. **New token** → nombre (ej. `RDZ Deliveries`), tu espacio de trabajo, y
   marca la capacidad **Notion API** → **Create token**.
3. **Cópialo ahora.** Notion lo muestra una sola vez.

En planes Business/Enterprise la creación de tokens viene bloqueada; el dueño
del espacio la habilita en **Settings → Connections**.

## 2. Crear la base de datos y compartirla

1. En Notion, crea una página nueva y adentro una **base de datos** (tabla).
   **No necesita columnas especiales** — con el título le basta; el detalle va
   en el cuerpo de cada página.
2. Abre la base de datos, botón **•••** arriba a la derecha → baja hasta
   **Add connections** → busca tu token por nombre y selecciónalo.

   Este paso es el que más se olvida. Sin él la API responde
   *"Could not find database"* aunque el token sea correcto.

3. Copia el ID de la URL: los 32 caracteres entre la última `/` y el `?`.

   Sirve tanto el enlace de la **tabla** como el de la **página que la
   contiene** — si el id resulta ser una página, la app busca la primera tabla
   adentro. El enlace que da "Copy link" sobre una página funciona.

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
