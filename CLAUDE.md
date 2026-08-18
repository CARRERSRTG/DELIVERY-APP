# Instrucciones del proyecto

## Documentación viva en Notion — obligatorio

Existe una documentación viva de este proyecto en Notion, y **mantenerla al día
es parte de cada cambio**, no una tarea aparte:

**https://app.notion.com/p/RDZ-Deliveries-Documentaci-n-3c069c11154f812a8684e0d5737b3dbf**

Está para una situación concreta: que alguien que llega **sin ningún contexto**
—una persona nueva, o un asistente en una sesión limpia— pueda entender el
estado de la app y seguir trabajando leyendo solo eso.

Secciones: 📐 Arquitectura · 🗺️ Estado actual · ⚙️ Setup ·
🧠 Decisiones (ADR, base de datos) · 📝 Changelog (base de datos) ·
🔜 Próximos pasos.

### Reglas

1. **Cada cambio de código actualiza Notion en la misma sesión**, sin que nadie
   lo pida. Como mínimo: una fila nueva en el Changelog.
2. **El historial nunca se borra.** Changelog y ADR solo crecen. Una decisión
   que cambia se marca *Reemplazada* y se escribe una nueva; un dato equivocado
   se corrige **con una nota dentro de la misma entrada**, no reescribiendo.
3. **Se escribe para quien no estuvo.** Nada de "se arregló el bug": qué
   fallaba, por qué, y qué se descartó.
4. **Un cambio de arquitectura toca dos páginas:** Arquitectura y su ADR.
5. Los números llevan fecha, porque envejecen.

El token de Notion **no vive en el repo**. Está en las variables de entorno de
Vercel (`NOTION_TOKEN`) y el asistente lo recibe del usuario cuando hace falta.

## Flujo por cada cambio

1. Implementar
2. `npx tsc --noEmit` y `npx vitest run`
3. Subir versión en `package.json` **y** en `APP_VERSION` de
   `src/lib/constants.ts` — los dos, siempre
4. `npx next build` (es más estricto que `dev`)
5. Commit
6. `git fetch origin` → `git rebase origin/main` → `git push`
7. Si cambia el comportamiento: entrada en `DECISIONS.md` **y** en el ADR de
   Notion
8. Actualizar Notion (regla 1)

## Antes de cambiar comportamiento

Lee `DECISIONS.md`. Si una petición contradice una decisión registrada, **dilo
antes de implementarla** y cita la entrada: *"esto revierte D-012, que se
decidió porque X — ¿cambió esa razón?"*. No la bloquees; el negocio cambia y
las decisiones caducan. Pero que sea decisión consciente, no olvido.
