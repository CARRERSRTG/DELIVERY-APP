# Bitácora de decisiones — RDZ · Deliveries

> **Qué es esto.** Cada cambio de comportamiento del sistema, con **el porqué**.
> No es un changelog de código (para eso está `git log`): es el registro de las
> decisiones de negocio y del razonamiento detrás de ellas.

## Cómo usarlo

**Para el equipo:** antes de pedir un cambio, busca aquí si el tema ya se
decidió. Si vas a revertir algo, escribe por qué cambió la situación — eso es
lo que evita dar vueltas en círculo.

**Para Claude (el asistente):** lee este archivo antes de cambiar comportamiento.
Si una petición contradice una decisión registrada, **dilo antes de
implementarla** y cita la entrada: *"esto revierte D-012, que se decidió porque
X — ¿cambió esa razón?"*. No la bloquees; el negocio cambia y las decisiones
caducan. Pero que sea una decisión consciente, no un olvido.

## Formato

Cada entrada lleva un id (`D-001`), la fecha, la versión donde entró, quién lo
pidió, **el porqué**, y las consecuencias que se aceptaron a cambio.

El campo **Razón** debe venir de quien pidió el cambio. Donde diga
`⚠️ RAZÓN PENDIENTE`, hay que llenarlo — una decisión sin porqué es la que
alguien revierte por accidente seis meses después.

---

## D-001 · Los choferes no pueden crear órdenes
**Fecha:** 2026-08-11 · **Versión:** v0.9.64 · **Pedido por:** Andrés

**Cambio:** Se quitó la capacidad de crear órdenes al rol Chofer.

**Razón (textual):** *"¿Pueden los choferes agregar entregas si nadie las
programó? No, el gerente de logística se encargará de que todos hagan bien su
trabajo."*

**Consecuencia aceptada:** si un cliente pide algo en ruta, el chofer tiene que
llamar a oficina en vez de registrarlo él. Se prefiere eso a que entren órdenes
sin pasar por planeación.

---

## D-002 · El recargo por entrega el mismo día queda en $0
**Fecha:** 2026-08-11 · **Versión:** v0.9.63 · **Pedido por:** Andrés

**Cambio:** La función existe y es configurable en Ajustes, pero el monto queda
en 0 (apagada). Se probó con $35 y se revirtió.

**Razón (textual):** *"no no, eso del mismo día bórralo o déjalo en 0 para
configurarlo más adelante."*

**Nota:** el código está completo y probado. Activarla es cambiar un número en
Ajustes, no volver a programar.

---

## D-003 · Registro de incidentes de choferes
**Fecha:** 2026-08-11 · **Versión:** v0.9.65 · **Pedido por:** Andrés

**Cambio:** El gerente de logística puede registrar incidentes con costo
estimado, ligados opcionalmente a una orden.

**Razón (textual):** *"el gerente de logística debería poder registrar si un
chofer hace algo que le cuesta dinero a la empresa… hoy el chofer tuvo mala
actitud y en vez de organizar su ruta salió a una entrega y tuvo que regresar
al mismo lugar para la siguiente, en vez de hacerlas juntas."*

**Alcance:** hoy solo lo ven logística y admin.

---

## D-004 · Cualquier orden se puede programar, aunque no esté lista
**Fecha:** 2026-08-12 · **Versión:** v0.9.68 · **Pedido por:** Andrés

**Cambio:** El Gestor de Rutas muestra órdenes en borrador y pendientes, no solo
las aprobadas. Solo quedan fuera las entregadas, recogidas, canceladas y
rechazadas.

**Razón (textual):** *"quiero que todas las órdenes se puedan asignar aunque no
estén listas, que se puedan programar en Routes Manager."*

**Consecuencia aceptada:** se puede planear una ruta con órdenes que el almacén
todavía no prepara. La columna Estado en el pool muestra en qué etapa va cada
una, para que el despachador sepa lo que está planeando.

**Efecto secundario que hubo que resolver:** la base de datos rechazaba que
logística editara órdenes no aprobadas (migración 042). Sin eso, reordenar una
parada se revertía sola.

---

## D-005 · Marcar entregadas en lote (solo admin)
**Fecha:** 2026-08-12 · **Versión:** v0.9.70 · **Pedido por:** Andrés

**Cambio:** El admin puede seleccionar varias órdenes y pasarlas todas a
Entregada, saltándose el flujo normal.

**Razón (textual):** *"porque apenas se está empezando a implementar el
sistema"* — hay órdenes que ya se entregaron en la vida real antes de que
existiera el sistema.

**Salvaguarda:** cada orden registra en su historial *"El administrador [nombre]
la marcó como entregada (cierre durante la implementación)"*. El cierre manual
nunca es silencioso.

**Revisar cuando:** termine la implementación inicial. Es una herramienta de
arranque, no de operación diaria.

---

## D-006 · "Pallets" en ambos idiomas
**Fecha:** 2026-08-12 · **Versión:** v0.9.72 · **Pedido por:** Andrés

**Cambio:** La interfaz en español dice "Pallets", no "Tarimas".

**Razón (textual):** *"cambia las palabras tarimas por pallets independiente del
idioma."*

---

## D-007 · Sin arrastrar en el Gestor de Rutas: solo flechas
**Fecha:** 2026-08-12 · **Versión:** v0.9.77 · **Pedido por:** Andrés

**Cambio:** Se eliminó arrastrar y soltar filas en la pestaña Rutas. Las paradas
se reordenan solo con las flechas ↑/↓.

**Razón (textual):** *"no ocupo arrastrar, elimina eso, solo con las flechas."*

**Contexto:** el arrastre además causaba un bug — al presionar una flecha, el
navegador iniciaba el arrastre de la fila en vez de registrar el clic.

---

## D-008 · Migración completa a Google Maps
**Fecha:** 2026-08-12 · **Versiones:** v0.9.84 – v0.9.91 · **Pedido por:** Andrés

**Cambio:** Rutas, distancias, tiempos, geocodificación y el mapa visual pasaron
de OpenStreetMap/OSRM a Google (Routes API + Maps JavaScript API).

**Razón (textual):** *"para que en el logistic manager view se calculen las
rutas correctamente, con tiempo y distancia reales en tiempo real, y también si
hay que hacer un desvío o un regreso por una highway que todo eso se tome en
cuenta tal cual como en Google Maps."*

**Resultado medido:** en un ciclo de 4 paradas del Valle, Google trazó
123.9 mi / 2h16m donde OSRM decía 122.3 mi / 2h31m — ruta más larga pero 15 min
más rápida, porque usa velocidades reales de autopista.

**Costo aceptado:** Routes API y Maps JS cobran por uso. Se mitigó con caché de
10 minutos para peticiones idénticas.

**Decisión técnica derivada:** se usan **dos llaves** de Google — una de
servidor (rutas, geocodificación) y otra de navegador restringida por dominio.
Reusar la de servidor en el navegador permitiría que alguien la robara y gastara
el presupuesto de rutas.

---

## D-009 · App Android para choferes con GPS en segundo plano
**Fecha:** 2026-08-12 · **Versiones:** v0.9.86 – v0.9.89 · **Pedido por:** Andrés

**Cambio:** APK (Capacitor) que carga el sitio en vivo y agrega rastreo GPS
mientras el chofer está en turno.

**Razón (textual):** *"quiero que hagamos una APK para que pueda llevarle el GPS
a los conductores… así puedo ver en tiempo real dónde están."*

**Alcance decidido:** rastreo **atado al turno** — arranca al marcar entrada,
para al marcar salida. Nunca fuera del horario laboral.

**Condiciones confirmadas por el negocio:** teléfonos propiedad de la empresa;
los choferes fueron informados y lo aceptaron.

**Consecuencia aceptada:** ningún blindaje es 100% (batería, señal, gestores
agresivos de Samsung/Xiaomi). Por eso el Gestor de Rutas avisa *"X chofer(es) no
están reportando"* — un camión se marca como no-reporta en vez de desaparecer
callado.

---

## D-010 · La app del chofer no menciona el rastreo
**Fecha:** 2026-08-12 · **Versión:** v0.9.93 · **Pedido por:** Andrés

**Cambio:** Se quitó el aviso *"Compartiendo tu ubicación"* de la tarjeta de
turno. Ahora solo muestra el reloj (En turno / Marcar salida).

**Razón (textual):** *"no quiero que los conductores sepan del tracking como
tal, ahora solo que aparezca como on the clock y clock out y ya."*

**Base:** ver D-009 — los choferes ya fueron informados y lo aceptaron por
escrito. Lo que se quitó es el recordatorio en pantalla, no el consentimiento.

**Límite técnico (no removible):** Android **obliga** a mostrar una notificación
permanente mientras corre el GPS en segundo plano, y dibuja su propio indicador
de ubicación en la barra de estado. Ninguna app puede suprimir eso. El chofer
seguirá viendo *"RDZ Deliveries — Turno en curso"* todo el turno.

---

## D-011 · Tarjetas colapsadas en celular
**Fecha:** 2026-08-12 · **Versiones:** v0.9.94 – v0.9.95 · **Pedido por:** Andrés

**Cambio:** En celular cada orden se pliega a una sola línea: ID · etapa · tipo ·
sigla de la tienda de origen. Se abre con el chevron.

**Razón (textual):** *"quiero que el tag Ready esté pegadito al ID en esa misma
fila, y todas las cargas colapsadas, y también el tipo y una etiqueta pequeña
con las siglas de la tienda de donde sale."*

**Consecuencia:** en computadora no cambia nada — ahí ya hay columnas de Etapa,
Tipo y Tienda.

**Refinamiento (2026-08-13, v1.0.0):** *"que siempre al lado del tag de Listo
también esté el tag del tipo de orden que es."* El tipo se mostraba como texto
plano mientras la etapa y la tienda sí eran etiquetas — tres datos en una línea
solo se leen si los tres parecen etiquetas. Ahora es una píldora con contorno
(secundaria frente a la etapa, que va rellena) y se muestra **siempre**: si la
orden no tiene tipo, aparece "—" en vez de desaparecer, porque un tipo faltante
es algo que alguien tiene que llenar.

---

## D-012 · El checkbox solo para quien tiene acciones en lote
**Fecha:** 2026-08-12 · **Versión:** v0.9.95 · **Pedido por:** Andrés

**Cambio:** La columna de selección múltiple solo aparece para admin, gerente,
logística, contabilidad y ventas. Los choferes ya no la ven.

**Razón (textual):** *"el checkbox arriba del driver no lo ocupa, nadie lo
ocupa, eso es solo para admin para seleccionar varios al mismo tiempo."*

**Criterio aplicado:** un rol ve el checkbox solo si tiene al menos una acción en
la barra de lote. Un chofer podía seleccionar filas que ningún botón podía
procesar.

---

## D-013 · El costo de entrega queda en blanco hasta que alguien lo elija
**Fecha:** 2026-08-12 · **Versión:** v0.9.80 · **Pedido por:** Andrés

**Cambio:** El formulario ya no rellena solo el precio de Lista cuando se
calculan las millas. Queda vacío hasta que el vendedor elija Lista, Descuento, o
escriba un monto.

**Razón (textual):** *"que se quede en blanco el fee a menos que lo seleccione
el usuario."*

**Por qué importa:** el auto-llenado comprometía en silencio un precio que nadie
había acordado con el cliente.

---

## D-014 · Fechas en zona horaria fija del negocio
**Fecha:** 2026-08-12 · **Versión:** v0.9.75 · **Origen:** bug encontrado

**Cambio:** `todayISO`, `isOverdue`, `isToday` y `nowHHMM` calculan en
America/Chicago vía `Intl`, no con el reloj local del dispositivo.

**Razón:** el servidor (Vercel, UTC) y el navegador (Valle, Central) calculaban
"hoy" distinto por las tardes, lo que rompía la hidratación de React (errores
#418/#423/#425 en consola) y hacía que "hoy" dependiera del reloj del aparato.

**Regla derivada:** nunca usar `new Date().getDate()` ni `Date.now()` para
lógica de "hoy"/atrasado que se renderice. Usar los helpers de `lib/utils.ts`.

---

## D-015 · Auto-cancelar órdenes muy atrasadas: apagado
**Fecha:** anterior a esta bitácora · **Estado:** `AUTO_CANCEL_LATE_ENABLED = false`
**Razón registrada:** 2026-08-12 por Andrés

**Situación:** existe la automatización que cancela órdenes con más de 2 días de
atraso sin reprogramar, pero está desactivada.

**Razón (textual):** *"Se apagó porque está en producción la app iniciando y
esas órdenes no se cancelaron, sí se entregaron, solo que no se siguieron los
pasos en la app."*

**En claro:** durante el arranque hay órdenes que **sí se entregaron en la vida
real** pero quedaron atoradas en una etapa vieja porque nadie las movió en el
sistema. Para la automatización se ven idénticas a una orden abandonada. Si se
prendiera hoy, cancelaría entregas que de hecho se hicieron — y dejaría el
historial mintiendo.

**Relación:** misma causa raíz que D-005 (marcar entregadas en lote). Las dos
existen porque el trabajo real ocurrió antes de que el sistema lo registrara.

**Revisar cuando:** (1) se cierre el rezago con la herramienta de D-005, y
(2) el equipo lleve un tiempo siguiendo el flujo completo en la app. A partir de
ahí, una orden vieja y atorada sí significa abandonada, y la automatización
haría lo correcto. Antes de prenderla, revisar que no quede ninguna entrega real
en una etapa vieja.

---

## D-016 · Tres niveles de detalle en la tabla de paradas
**Fecha:** 2026-08-12 · **Versión:** v0.9.98 · **Pedido por:** Andrés

**Cambio:** En la tabla de paradas del Gestor de Rutas, el destino del toque
cambia según dónde caiga:

| Tocas | Pasa |
|---|---|
| El **ID** | Se abre la orden completa |
| La **fila** | El mapa aísla esa parada y dibuja su ruta recolección→entrega |
| **Fuera** (la tarjeta) | Vuelve a mostrar todas las paradas de ese chofer |

**Razón (textual):** *"haz que si toco el ID en la tabla ahí en viajes se abra
la orden para verla, y si toco el row me va a llevar en el mapa a ver esa orden
y la ruta, y si aprieto fuera me aparecen todas las de ese conductor."*

**Consecuencia aceptada:** las flechas ↑/↓ y el selector de viaje detienen el
clic — reordenar es una edición, no un "muéstrame", y no debe secuestrar el
mapa hacia esa parada.

**Relación:** se apoya en D-007 (sin arrastrar, solo flechas). Ahora que la fila
ya no se arrastra, el clic quedó libre para significar "enfocar en el mapa".

---

## D-017 · Quien recoge una orden sin chofer, queda como su chofer
**Fecha:** 2026-08-13 · **Versión:** v1.0.1 · **Origen:** bug reportado

**Cambio:** Si un chofer marca "Recogido" en una orden que no tiene chofer
asignado, la orden queda a su nombre automáticamente.

**Razón:** Andrés reportó que marcó una orden como recogida y *"en la web sí me
sale pero en la APK no me sale en Out for delivery"*. No era un fallo de la
APK: la orden (FQ115) estaba en `picked_up` con `assigned_driver` en nulo. La
vista del chofer solo muestra lo asignado a él, así que la orden **desapareció
de la cola de todos los choferes** justo cuando ya iba en el camión.

**Por qué así:** si alguien tiene físicamente la carga, es su entrega. Dejarla
sin dueño en reparto es el peor estado posible — nadie la ve y nadie responde
por ella.

**Consecuencia aceptada:** un chofer puede quedar asignado a una orden que
logística no le puso. Se prefiere eso a una orden en tránsito sin responsable.

**Pendiente relacionado:** la página de Órdenes (`/`) **no filtra por chofer** —
ahí un chofer ve todas las órdenes de la empresa, a diferencia de su propia
vista. Así fue como recogió una orden que no era suya. Falta decidir si eso se
restringe.

---

## D-018 · La vista del chofer: sin comprobante y un solo botón para recoger
**Fecha:** 2026-08-13 · **Versión:** v1.0.1 · **Pedido por:** Andrés

**Cambio:** Al abrir una orden como chofer se quitó el botón "Comprobante", y
recoger pasó de dos toques (Recoger → Confirmar carga) a **uno solo**.

**Razón (textual):** *"cuando abro la orden en el view de conductor, bórrame el
slip, y el pickup miro que son 2 botones, entonces solo deja 1 y que de un solo
se cambie a recogido."*

**Consecuencia aceptada:** el chofer ya no puede registrar una **carga parcial**
desde ese botón (llevarse 3 de 5 pallets y dividir el resto). Toma la carga
completa tal como está contada. La oficina conserva el flujo de dos pasos, que
es donde dividir una carga tiene sentido.

**Detalle:** si la orden no trae conteo de pallets, se marca recogida sin
escribir un 0 encima — un número que la oficina no llenó no debe convertirse en
un número equivocado desde el camión.

---

<!-- PLANTILLA — copia esto para una entrada nueva
## D-0XX · Título corto en presente
**Fecha:** YYYY-MM-DD · **Versión:** vX.Y.Z · **Pedido por:** nombre

**Cambio:** qué hace distinto el sistema ahora.

**Razón:** por qué se pidió. Textual cuando se pueda.

**Consecuencia aceptada:** qué se sacrificó a cambio.

**Revisar cuando:** (opcional) qué haría que esta decisión caduque.
-->
