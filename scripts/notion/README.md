# Documentación viva en Notion

**https://app.notion.com/p/RDZ-Deliveries-Documentaci-n-3c069c11154f812a8684e0d5737b3dbf**

Existe para una situación concreta: que alguien que llega **sin ningún
contexto** —una persona nueva, o el asistente en una sesión limpia— pueda
entender el estado de la app y seguir trabajando leyendo solo eso.

## Qué hay

| Sección | Qué es | Cómo se mantiene |
|---|---|---|
| 📐 Arquitectura | de qué está hecho y por qué | a mano |
| 🗺️ Estado actual | qué funciona, qué está a medias, qué está roto | a mano |
| ⚙️ Setup | cómo levantarlo de cero | a mano |
| 🧠 Decisiones (ADR) | base de datos, espejo de `DECISIONS.md` | `sync.mjs` |
| 📝 Changelog | base de datos, una fila por commit | `sync.mjs` |
| 🔜 Próximos pasos | lo que sigue y lo que está bloqueado | a mano |

## Sincronizar

```bash
NOTION_TOKEN=ntn_... node scripts/notion/sync.mjs
```

Agrega a Notion las decisiones de `DECISIONS.md` y los commits de `git log` que
todavía no estén. **Solo agrega:** nunca reescribe ni borra nada, así que se
puede correr las veces que haga falta. Una segunda corrida seguida no hace nada.

El token es el mismo que usa `/api/notion-summary` y vive en las variables de
entorno de Vercel. **Nunca en el repositorio.**

## Lo que el script no puede hacer

Las cuatro páginas de prosa. Son explicaciones de cómo funcionan las cosas hoy
y por qué se eligieron así; eso no sale de un `git log`. Se editan a mano, **en
la misma sesión del cambio que describen**.

Si esas páginas se quedan atrás, la documentación miente — y una documentación
que miente es peor que no tener ninguna, porque la gente le cree.

## Reglas

1. Cada cambio de código actualiza Notion en la misma sesión, sin que nadie lo
   pida. Como mínimo, correr `sync.mjs`.
2. El historial nunca se borra. Una decisión que cambia se marca *Reemplazada*
   y se escribe una nueva; un dato equivocado se corrige con una nota dentro de
   la misma entrada.
3. Se escribe para quien no estuvo: qué fallaba, por qué, y qué se descartó.
4. Un cambio de arquitectura toca dos lugares: la página de Arquitectura y su
   ADR.
5. Los números llevan fecha, porque envejecen.

## Si hay que empezar de cero

`ids.json` tiene los ids de las seis secciones. No son secretos: sin el token no
sirven de nada. Si alguien borra una sección en Notion, hay que crearla de nuevo
y actualizar su id aquí — y en el caso de las bases de datos, volver a correr
`sync.mjs`, que la rellena entera desde el repositorio.
