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

**Cambio:** El Gestor de Rutas muestra órdenes pendientes y sin preparar, no
solo las aprobadas. Quedan fuera las entregadas, recogidas, canceladas y
rechazadas.

> **CORREGIDO (2026-08-17, v1.8.3).** Esto originalmente incluía los
> **borradores**, y estaba mal leído de mi parte. El dueño lo aclaró: *"sí los
> pedí, pero no los que están como draft, porque no están creados"*. Un
> borrador no se ha enviado — no es una orden todavía, y planear un camión
> alrededor de algo con lo que nadie se ha comprometido no es planear. Lo que
> sí se pedía era no tener que esperar al almacén: una orden pendiente o sin
> preparar sigue siendo programable.

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

**Refinamiento (2026-08-13, v1.0.4):** *"quiero que se pueda ver la fecha de
entrega ahí también, sin hacer más grande esa tarjeta; Customer lo puedes poner
solo como CUS y que esté al lado del ID."*

La fila quedó con cuatro datos en una sola línea:

```
ID  #FQ115 CUS        [Recogido]  Ago 13  [BRO]  ▸
```

El **tipo** se abrevia a tres letras (CUS / INT / TRA) y se mueve **junto al
ID**, porque dice lo que la orden **es** — a diferencia de la etapa y la fecha,
que dicen dónde **está**. La **fecha** se muestra sin año (la lista solo tiene
días alrededor de hoy) y **se pone roja si ya pasó**, que es lo único de esa
línea que un chofer no puede pasar por alto.

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

**Añadidos (v1.0.2 / v1.0.3):**
- El comprobante también se quitó de la pantalla posterior a la entrega, que la
  primera pasada dejó fuera. "Listo" quedó como botón principal.
- *"Si dice sin teléfono de cliente, hazlo como los demás, como un bubble para
  que no se mire así de feo."* Era texto gris suelto entre botones; ahora es una
  píldora de la misma forma pero con borde punteado y sin cursor de clic —
  mantiene la fila pareja sin fingir que se puede presionar.
- **Bloqueo de entrega visible:** `require_pod` está activo, así que entregar
  exige firma o foto. El botón solo revisaba el nombre de quien recibió, así que
  se podía presionar y ser rechazado con un aviso fácil de perder — se sentía
  como un botón muerto (reportado con FQ105). Ahora la condición se calcula una
  vez y controla tanto el aviso en pantalla como el botón deshabilitado.

---

## D-019 · El chofer ve la factura, no el código de orden
**Fecha:** 2026-08-13 · **Versión:** v1.0.5 · **Pedido por:** Andrés

**Cambio:** En las listas que ve un **chofer**, la primera columna muestra el
**número de factura** en lugar del código de orden (`#FQ115`). El encabezado
también cambia a "Factura #".

**Razón (textual):** *"en driver view, el ID sustitúyelo por el invoice
number."*

**Por qué tiene sentido:** el chofer trae papeles en la mano y los coteja por
factura; el código de orden es del sistema, no de la calle.

**Va por rol, no por pantalla:** sigue al *usuario*, así que aplica igual en su
vista de Chofer y en el tablero de Órdenes. Los demás roles no cambian.

**Casos cubiertos:**
- **Sin factura:** cae al código de orden. Hoy ninguna orden en ruta llega sin
  factura (verificado: 0 de las que están listas o recogidas), pero 8 de 41 en
  total no la traen — mejor eso que una fila en blanco.
- **Varias facturas:** hay órdenes con `177987, 177986`. El texto se recorta con
  puntos suspensivos en vez de empujar las etiquetas fuera de la pantalla; el
  valor completo sigue disponible al mantener presionado.

---

## D-020 · Ventas, almacén y chofer ven 2 días atrás hasta mañana
**Fecha:** 2026-08-13 · **Versión:** v1.0.6 · **Pedido por:** Andrés

**Cambio:** Las tres vistas operativas (Ventas, Almacén, Chofer) muestran una
ventana de cuatro días: **dos días atrás hasta mañana**. Los roles de oficina
(admin, gerente, logística, contabilidad) no tienen filtro y ven todo.

**Razón (textual):** *"recuerda, sales, warehouse y driver solo pueden ver
órdenes de 2 días atrás y el día siguiente."*

**Qué cambió respecto a antes:**
- **Hacia adelante:** antes veían **cualquier** fecha futura; ahora se corta en
  mañana. Este es el cambio de fondo.
- **Hacia atrás:** antes eran 2 días para órdenes abiertas pero solo 1 para
  entregadas/canceladas. Ahora son 2 parejo — la ventana habla de *cuándo*, no
  del estado.

**Escapes deliberados:**
- Las órdenes **sin fecha** siempre se ven — están en proceso de programarse, y
  esconder una que nadie ha fechado la dejaría varada.
- **Buscar por factura** atraviesa la ventana en las tres pantallas.
- **Reprogramar** una orden atrasada hacia dentro de la ventana la regresa.

**⚠️ Riesgo que conviene vigilar:** un vendedor que cree una orden para dentro
de una semana **dejará de verla en su lista** hasta que falte un día. Si no
tiene factura todavía, tampoco podrá encontrarla buscando. Si eso estorba en la
práctica, la salida más simple es ampliar solo el futuro para Ventas
(`RETENTION_DAYS_AHEAD`) sin tocar almacén ni choferes.

---

## D-021 · "Mi ruta": el chofer ve el plan, sin poder cambiarlo
**Fecha:** 2026-08-13 · **Versión:** v1.1.1 · **Pedido por:** Andrés

**Cambio:** Pestaña nueva **🧭 Mi ruta** para el chofer, con el orden y los
viajes que planeó logística. Puede ver y completar parada por parada; **no**
puede reordenar, reasignar ni optimizar.

**Razón (textual):** *"haz una separate view para el driver, así como el
logistic manager pone los viajes y las órdenes, así quiero que se le aparezca al
driver para que él sepa el orden y la ruta, pero obviamente solo es para ver, no
puede hacer lo mismo que el logistic manager, pero ahí él puede completar orden
por orden."*

**Cómo se diseñó, y por qué así:** no es la pantalla del despachador con los
botones quitados. Un despachador acomoda una flota entera sentado en un
escritorio; un chofer está en la cabina con **una pregunta a la vez**. Por eso
el orden de la pantalla es:

1. **Progreso** — "3 de 7 entregadas". Es lo que un chofer se pregunta todo el día.
2. **La siguiente parada**, en su propia tarjeta con Navegar y Recoger/Entregar.
   Todo lo demás es contexto; esto es lo único que hay que hacer ahora.
3. **El mapa** con pines numerados: verde lo hecho, naranja el siguiente, gris
   lo que falta — más su propia posición, para ubicarse contra el plan.
4. **El día completo** agrupado en los mismos viajes que armó logística, para
   poder planear con anticipación.

**Consistencia:** usa el mismo agrupamiento de viajes que el despachador, así
que "Viaje 2" significa lo mismo para los dos. Y el orden ya venía respetando
la secuencia optimizada (`routeOrder` usa `route_seq`), así que las dos
pantallas nunca se contradicen.

**Lo que a propósito NO hacía:** dibujar la ruta trazada por carretera, por el
costo de una llamada a Google por chofer cada vez que abriera la pantalla.

**Revisado (2026-08-13, v1.2.1):** *"cuando él presione por ejemplo Truckload 1,
automáticamente le salga la ruta en el mapa, y tiempo y distancia, y hacer eso
por truckload."* Se agregó, **bajo demanda**: nada se consulta hasta que el
chofer toca un viaje, y el resultado se guarda para el resto de la sesión. Así
se conserva la razón original (no gastar en llamadas que nadie pidió) y se
obtiene lo que se necesitaba.

**Un detalle que casi rompe el propósito de esta pantalla:** el endpoint de
rutas **reordena** las paradas — para eso existe. Usarlo tal cual le habría
dibujado al chofer **una secuencia distinta a la que está siguiendo**. Se
agregó `optimize: false` para trazar el camino **respetando el orden asignado**.
Medido en una ruta real del Valle: la secuencia optimizada da 123.9 mi / 2h16m,
mientras que la asignada da 161.1 mi / 2h50m — dibujar la primera habría sido
mentirle al chofer sobre su propio día.

---

## D-022 · La firma del cliente se puede apagar
**Fecha:** 2026-08-13 · **Versión:** v1.1.2 · **Pedido por:** Andrés

**Cambio:** Ajustes → Comprobante de entrega tiene un interruptor nuevo:
**"Pedir la firma del cliente"**. Encendido por omisión.

**Razón (textual):** *"have customer signature enable and disable in setting."*

**Cómo se relaciona con lo que ya existía:** el comprobante de entrega tiene dos
mitades — la firma y las fotos del material. `require_pod` dice si se exige
**algún** comprobante; este ajuste dice si la firma **se ofrece siquiera**.

**Interacción que se hizo explícita:** con la firma apagada **y** el comprobante
requerido, la única forma de entregar es con **foto del material**. Los Ajustes
lo advierten en pantalla, y el mensaje que ve el chofer cambia a "Se requiere
una foto del material" en vez de ofrecerle una opción que ya no tiene.

**Lo que se sigue registrando con la firma apagada:** quién recibió, la hora, y
la ubicación GPS de la entrega.

**Detalle técnico:** la validación vivía duplicada (una para deshabilitar el
botón, otra al guardar). Se unificó en una sola, porque dos copias de la misma
regla terminan divergiendo y dejan un botón que se presiona y no hace nada.

---

## D-023 · Las entregas sobreviven a las zonas sin señal
**Fecha:** 2026-08-13 · **Versión:** v1.2.0 · **Origen:** riesgo detectado

**Cambio:** Si un chofer marca **Recogido** o **Entregado** y no hay señal, la
acción se guarda **en el teléfono** y se envía sola cuando vuelve la conexión.
Mientras tanto la orden se ve como completada, para que no la haga dos veces.

**Razón:** hasta ahora, una entrega marcada en una zona muerta **se perdía**: la
escritura fallaba, salía un aviso rojo, y si el chofer ya había arrancado el
trabajo desaparecía. En el Valle con entregas rurales eso no es hipotético.

**Alcance deliberadamente angosto:** solo se encolan los hitos del chofer
(recogido / entregado). Todo lo demás sigue fallando de frente — un vendedor
editando una orden o un admin cambiando ajustes ve el error y reintenta; un
chofer parado en la puerta de un cliente no puede.

**Distinción clave:** solo se encola una falla de **red**. Un rechazo del
servidor (sin permiso, transición ilegal) **no** se encola, porque reintentarlo
jamás funcionaría y escondería un problema real detrás de un envío eterno.

**Cuándo se reenvía:** al recuperar conexión, al volver a la app, y cada minuto
como respaldo para señal intermitente que nunca dispara un evento limpio.

**Lo que ve el chofer:** una barra que dice cuántas entregas están guardadas y
que se enviarán solas. El aviso viejo de "sin conexión" ya **prometía** que los
cambios se guardaban localmente — no era cierto hasta ahora.

---

## D-024 · Cada viaje muestra su costo real, descarga incluida

**Fecha:** 2026-08-13 · **Versión:** v1.2.2 · **Pedido por:** Andrés

**Cambio:** en Routes Manager, cada viaje muestra sus propias millas y su tiempo,
desglosado en manejo + descarga, con hora de salida y de regreso al punto de
carga. La fila se pinta verde claro conforme cada parada se va entregando, y el
encabezado del viaje lleva un contador (3/5 entregadas → ✓ viaje entregado).

**Razón:** *"quiero que se mire por viaje distance y time tomando en cuenta que
cada viaje tiene stops y el tiempo de descarga ya programado, también quiero que
vaya apareciendo como con un light green la row a medida este se vaya
entregando."*

**Lo que destapó:** el total por chofer contaba **solo tiempo al volante**, y la
alerta de "más de 8 h" se medía contra ese número. Pero la descarga ya estaba
programada en cada orden (`delivery_duration`) y no se estaba sumando en ningún
lado. Un día de 6 h de manejo con ocho paradas de 30 min son casi 10 h reales y
el sistema lo daba por bueno. La alerta ahora se mide contra la **jornada
completa** — manejo + descarga + recarga entre viajes — así que empezará a
marcar rutas que antes pasaban calladas. Eso no es un falso positivo: es lo que
llevaba tiempo sin verse.

**Consecuencia aceptada:** una parada sin duración escrita cuenta 15 min por
omisión, y un "0" también, porque una parada nunca es instantánea; si la oficina
quiere el número exacto tiene que capturarlo. La recarga entre viajes (20 min)
sale solo en el total del día, no dentro de ningún viaje, porque no pertenece a
ninguno. Los números por viaje se borran al reordenar o mover cargas, en vez de
quedarse pegados al viaje equivocado.

**Revisar cuando:** si la jornada estimada se aleja seguido de la real, el
problema está en `delivery_duration`, no en el cálculo — ahí conviene medir
descargas reales y ajustar el default de 15 min.

---

## D-025 · Las paradas cercanas viajan juntas (agrupación por zona)

**Fecha:** 2026-08-13 · **Versión:** v1.3.0 · **Pedido por:** Andrés

**Cambio:** "Optimizar ruta" ahora decide **qué paradas comparten camión**, no
solo el orden dentro de cada viaje. La agrupación usa Clarke–Wright (el
heurístico estándar de ruteo con capacidad desde un depósito) más un pase
or-opt que reubica paradas sueltas mientras eso acorte el plan.

**Razón:** *"hay una ruta que hay 2 entregas bien cerca y que pueden ir en el
mismo viaje y el sistema de optimizar no lo mandó ahí."*

**La causa:** el repartidor viejo (`splitIntoTrips`) recorría la lista **en el
orden que traía** y cortaba un viaje nuevo cada vez que la suma de pallets
llegaba a la capacidad. La geografía **nunca entraba en la decisión**. Dos
entregas de la misma cuadra caían en camiones distintos solo porque el corte de
capacidad quedó entre ellas — y optimizar después no lo puede arreglar, porque
el ruteador solo reordena paradas **dentro** del viaje que se le entregó.

**Medido en el tablero real** (Maximo Garza, 2026-08-12, 7 paradas, 12 pallets
de capacidad): 321 mi → 218 mi en línea recta, **32% menos**. La agrupación
vieja mandaba una parada de McAllen colgada de un viaje a Brownsville, en dos
viajes distintos.

**División del trabajo:** aquí se decide *quién viaja con quién* (Google no
puede: no conoce la capacidad del camión); Google decide *el orden dentro de
cada camión* con tráfico real. Las distancias de la agrupación son en línea
recta a propósito — esta etapa solo necesita saber qué paradas están **cerca**,
y pedirle a Google una matriz completa costaría una llamada por cada par.

**Consecuencia aceptada:** una agrupación hecha **por una persona** se respeta y
no se reagrupa (columna nueva `load_auto`, migración 045). Sin esa distinción el
optimizador tenía que elegir entre pisar las divisiones deliberadas del
despachador o no reagrupar nunca, y ninguna de las dos sirve. Los viajes que ya
existían quedan marcados como deliberados, que es lo conservador; para soltarlos
está el botón **"Reagrupar por zona"**, que aparece solo cuando hay viajes
fijados.

**Revisar cuando:** si aparecen restricciones de ventana horaria duras (un
cliente que solo recibe de 8 a 10), la agrupación tendrá que considerarlas —
hoy solo considera capacidad y distancia, y las ventanas se revisan después,
cuando el tablero marca las paradas que llegan tarde.

---

## D-026 · La firma nace apagada, y entregar es un toque

**Fecha:** 2026-08-13 · **Versión:** v1.3.1 · **Pedido por:** Andrés

**Cambio:** (a) la satisfacción del cliente ya no aparece en la vista del
chofer; (b) la firma del cliente queda **apagada por omisión** (migración 046);
(c) cuando no hay nada que capturar, "Entregar" marca la entrega **de un solo
toque** y muestra la pantalla de entregado, sin formulario de por medio.

**Razón:** *"en la vista de conductor elimina ese customer satisfaction"* y
*"por default que quede inactivo la firma, entonces al darle delivered de un
solo el popup de delivered."*

**Por qué la calificación no es del chofer:** puntuar la felicidad del cliente
es una lectura de la oficina, no algo que se le pide a un chofer parado en la
puerta. Ventas tampoco la ve; eso ya era así.

**Cuándo NO es un toque:** si la firma está encendida, o si la oficina exige
comprobante (`require_pod`) y la orden todavía no trae foto, el formulario se
abre igual y dice qué falta. Un toque nunca vale saltarse la evidencia que la
oficina pidió. Con `require_pod` encendido —como está hoy— el toque único
aplica a las órdenes que ya traen foto; para que aplique siempre hay que apagar
"requerir comprobante" en Ajustes, y esa es una decisión de negocio, no mía.

**Consecuencia aceptada:** en una entrega de un toque **no se captura quién
recibió**. Se guarda como nulo (no como texto vacío) y la bitácora dice
"Entregado" en vez de inventar un nombre. La hora, el GPS y el chofer siguen
quedando registrados. Si un cliente reclama "yo no recibí eso", ese nombre es
justamente lo que haría falta — por eso la firma sigue siendo un interruptor en
Ajustes y no se eliminó.

**Revisar cuando:** si aparecen disputas de entrega, lo primero que hay que
volver a encender es la firma.

---

## D-027 · Un latido, para poder distinguir "estacionado" de "muerto"

**Fecha:** 2026-08-14 · **Versión:** v1.3.2 · **Pedido por:** Andrés (diagnóstico)

**Cambio:** (a) el teléfono reporta su posición **al menos cada 5 minutos**
aunque el camión no se mueva; (b) cada reporte incluye el **nivel de batería**;
(c) la app detecta y ofrece apagar la **hibernación de Android** ("Pausar la
actividad de la app si no se usa"), que es un ajuste distinto al de batería.

**Razón:** *"en la app del conductor autorizo el permiso y lo de la batería
pero aun así se le pausó la app, puedes ver qué pasó."*

**Lo que los datos sí mostraban:** el rastreo solo corre en turno, por diseño.
El hueco de 32 horas cae fuera de todo turno, así que ese no es el problema. En
el turno abierto hubo 5 posiciones en 67 minutos, con velocidades de 0 a 1.3
m/s — el teléfono estuvo prácticamente quieto, y con el filtro de 40 m un
teléfono quieto **no debe** reportar. Es decir: **los datos no alcanzan para
probar que se pausó, ni para descartarlo.**

**Ese es el verdadero hallazgo.** Un camión estacionado y una app muerta se ven
**idénticos**: los dos son silencio. Por eso no se podía responder la pregunta,
y por eso la bandera de "no reporta" del despachador (15 min) se disparaba con
choferes que solo estaban descargando.

> **CORRECCIÓN (2026-08-14, v1.3.7).** Aquí decía que "si falta el latido, la
> app no estaba corriendo, y eso ya es evidencia". **Eso resultó falso.** El
> latido es un temporizador de JavaScript, y Android **suspende** los
> temporizadores del WebView cuando la app pasa a segundo plano. Se midió en
> producción: posiciones capturadas por el código nativo llegaron a guardarse
> **78 minutos tarde**, encoladas hasta que la app despertó.
>
> Lo correcto: un latido **presente** prueba que la app está viva y en primer
> plano. Un latido **ausente** NO prueba que esté muerta — puede ser
> simplemente la pantalla apagada. Un latido confiable en segundo plano
> necesita trabajo nativo que el plugin de GPS no ofrece. Ver D-031.

**El hueco real en el código:** la app pedía exención de optimización de batería
y abría la pantalla del fabricante, pero **nunca revisaba la hibernación** —
Android 11+, ajuste aparte, y su propia pantalla usa la palabra "pausar". Mide
si la app se **abre**, no si trabaja; un teléfono en el soporte del camión
trabaja todo el día y no se abre nunca. Un chofer puede conceder todo y aun así
quedar pausado por esto.

**Consecuencia aceptada:** un latido cada 5 minutos son ~100 filas por chofer
por jornada en vez de ~15. Es barato y compra la única señal que hacía falta.
El latido se estampa con la hora actual porque eso es lo que significa: *ahora
mismo el chofer sigue aquí y la app sigue viva*.

**Pendiente del usuario:** el aviso de hibernación es código **nativo** — no
llega hasta que se recompile el APK. El latido y la batería sí llegan de
inmediato, porque el shell carga el sitio en vivo.

---

## D-028 · El chofer no entra hasta que el teléfono pueda reportar

**Fecha:** 2026-08-14 · **Versión:** v1.3.3 · **Pedido por:** Andrés

**Cambio:** dentro del APK, la vista del chofer queda **bloqueada** hasta que el
teléfono tenga todo lo que hace falta para reportar: ubicación, "permitir
siempre", notificaciones, exención de batería y **no pausar la app**. Se piden
**de uno en uno**, en orden, con una alerta que pulsa.

**Razón:** *"haz que la app pida todos esos permisos para que no pase eso, pero
si él no aprueba los permisos no lo deja pasar, solo para blindar, y ten un
attention getter para eso."*

**De uno en uno, no todos juntos:** Android **no permite** pedir "permitir
siempre" antes de que ya esté concedida la ubicación en primer plano — pedirlo
antes es una negación automática. Cinco botones a la vez le habrían enseñado al
chofer que cuatro de ellos no hacen nada.

**Los dos límites que evitan que el blindaje sea el problema más grande:**

1. **Solo bloquea lo que puede LEER como denegado.** Lo que el teléfono no
   tiene (Android 9 no tiene permiso de ubicación en segundo plano; antes de
   Android 13 no hay permiso de notificaciones) o lo que un APK viejo no sabe
   contestar, regresa indefinido y **nunca** cuenta en contra. Un chofer
   bloqueado por un ajuste que no podemos verificar no puede entregar, y eso es
   peor que un camión sin rastrear. Hay 8 pruebas que fijan exactamente esa
   regla.
2. **Solo corre dentro del APK y solo para el rol chofer.** En un navegador
   ninguno de estos ajustes existe; bloquear ahí dejaría a la oficina fuera de
   su propio sistema.

**Consecuencia aceptada:** un chofer que se niegue **no puede trabajar** en la
app. Eso es exactamente lo pedido, y es defendible porque el trabajo del
despachador depende de ver el camión — pero significa que una negación se
convierte en una llamada a la oficina, no en un turno sin rastreo. Tras dos
negativas Android deja de mostrar el diálogo; la pantalla lo detecta y manda a
los ajustes de la app en vez de dejar al chofer tocando un botón muerto.

**Pendiente del usuario:** es código **nativo** — no llega hasta recompilar el
APK. El Java ya compila (`compileDebugJavaWithJavac`, BUILD SUCCESSFUL).

---

## D-029 · La foto se pide donde se puede tomar, y la app se actualiza sola

**Fecha:** 2026-08-14 · **Versión:** v1.3.4 · **Pedido por:** Andrés

**Cambio:** (a) la hoja de entrega ahora lleva la **cámara adentro**; (b) se
apagó "requerir comprobante" (migración 047); (c) una página que quedó vieja lo
**detecta y se refresca sola**, y avisa cuando hay un APK nuevo.

**Razón:** *"el conductor me reporta que no le pregunta quién recibió y que él
lo pone y no puede avanzar para marcar como delivered… ¿podemos hacer una
versión que él sepa cuándo se lanzó una nueva versión y él solo se actualice o
refresque? y también en web igual."*

**El atasco, exactamente:** con la firma apagada (046), `require_pod` solo se
podía cumplir con una foto. La hoja de entrega **decía** "se requiere una foto
del material" y **no tenía cámara adentro** — la única estaba más arriba en la
orden, fuera del popup. El chofer escribía el nombre, presionaba Confirmar, y
no pasaba nada, sin salida desde donde estaba parado. Eso no era una regla mal
puesta: era una exigencia hecha en un lugar donde no se podía cumplir.

**Se arregló primero la hoja, después se apagó la regla.** En ese orden a
propósito: apagar la regla sin arreglar la hoja habría escondido el defecto
hasta que alguien volviera a encender "requerir comprobante" y el chofer
quedara atrapado otra vez.

**Dos clases de "versión vieja", que se confunden todo el tiempo:**

- **Web** — la página corre JavaScript de un deploy anterior. Es la común y
  nadie la nota: el APK carga el sitio en vivo, así que un deploy **es** la
  actualización, pero solo para páginas cargadas después. Un teléfono abierto
  en el soporte desde las 6 a.m. sigue corriendo el código de esa mañana. Se
  cura con un refresco, y ahora la app lo hace sola.
- **APK** — el shell nativo es viejo (permisos, plugin de GPS, blindaje de
  batería). Ningún refresco arregla eso; hay que instalar un APK nuevo. Es
  raro y es el único que requiere que el chofer haga algo.

**Cuándo se refresca solo:** al volver a la app **y** si no hay nada a medias
en pantalla. Refrescar con una firma o un formulario a medio llenar tiraría
justo el trabajo más molesto de rehacer, en la puerta de un cliente. Un solo
intento automático: una página que se recarga y sigue viéndose vieja se
recargaría para siempre.

**Consecuencia aceptada:** cada página pregunta al servidor cada 5 minutos. Es
una respuesta de dos campos, sin caché a propósito — una respuesta cacheada
aquí anularía todo el punto.

---

## D-030 · El chofer puede estampar DÓNDE estuvo, aunque la parada ya esté cerrada

**Fecha:** 2026-08-14 · **Versión:** v1.3.6 · **Pedido por:** Andrés (falla reportada)

**Cambio:** un chofer puede hacer una edición sobre su propia parada ya cerrada
(`picked_up` / `delivered`) **solo** si lo único que cambia son las coordenadas
GPS (migración 048). Y un parche de fondo ya no muestra error al chofer.

**Razón:** *"cuando le doy delivered me sale error: no puedes editar órdenes que
están siendo delivered."*

**Lo que realmente pasaba:** la entrega **sí se guardaba**. Lo que fallaba era el
parche de GPS que llega un segundo después. El teléfono muchas veces no tiene
posición en el instante exacto en que el chofer toca Entregar, así que la app
marca la parada de inmediato y adjunta las coordenadas cuando llegan
(`attachLateFix`). Para entonces la fila ya está en `delivered`, y el guard no
tenía ninguna regla de misma-etapa para un chofer sobre una parada cerrada — así
que rechazaba la escritura y le decía al chofer, de forma alarmante, que algo
había salido mal con una entrega que ya estaba guardada.

**Lo mismo llevaba pasando con las recogidas, en silencio.**

**Por qué la regla quedó angosta:** habría sido una línea más corta decir
"los choferes pueden editar órdenes entregadas", y eso habría reabierto todo lo
que el guard existe para proteger. En vez de eso se comparan **todas** las demás
columnas: si algo más cambió, se rechaza igual. Verificado contra la base: pasa
el GPS tardío de entrega y de recogida; siguen rechazados cambiar pallets,
dirección, precio, borrar la firma, **y GPS+pallets en la misma escritura**.

**Segunda capa, en el cliente:** el parche de fondo ahora es de verdad
silencioso (`quiet`). Aunque falle por otra razón —sin señal, por ejemplo— el
chofer no debe ver un error por algo que nunca pidió y que no puede resolver;
un error ahí se lee como "tu entrega falló" cuando la entrega está guardada
desde hace rato.

**Consecuencia aceptada:** si el parche falla, la entrega queda **sin
coordenadas** y nadie se entera en el momento. Es lo correcto para el chofer,
pero significa que la ausencia de GPS en una entrega no prueba nada por sí
sola.

---

## D-031 · Al despertar la app, pide posición de inmediato

**Fecha:** 2026-08-14 · **Versión:** v1.3.7 · **Pedido por:** Andrés (falla reportada)

**Cambio:** cada vez que la app despierta —al abrirla y al volver a ella— pide
una posición **de inmediato**, en vez de esperar a que el camión se mueva.

**Razón:** *"cerré el app, luego la abrí 30 min después, y la app se tardó 45
minutos en decirme live de nuevo."*

**La causa, medida:** el vigilante nativo solo avisa después de **40 m de
movimiento**, y a propósito rechaza la posición cacheada del teléfono (D-?: una
posición vieja pondría al chofer en la bodega de hace horas). El latido tampoco
podía rescatarlo: **reenvía la última posición conocida, y tras reiniciar no hay
ninguna**. Camión parado + app recién abierta = silencio indefinido.

**La excepción es acotada:** al despertar se acepta una posición de hasta **2
minutos** de antigüedad. Suficientemente reciente para ser donde el chofer está
de verdad, y muchísimo mejor que nada. El vigilante sigue rechazando posiciones
cacheadas — esto es una excepción con límite, no un cambio de la regla.

**Lo que esto NO arregla, y hay que decirlo:** en el mismo análisis se
descubrió que **el latido no funciona en segundo plano**. Es un temporizador de
JavaScript y Android lo suspende cuando la app no está al frente; se midieron
posiciones nativas guardadas **78 minutos tarde**, encoladas hasta que la app
despertó. Eso invalida lo que D-027 afirmaba —que un latido faltante probaba
que la app estaba muerta— y esa entrada quedó corregida.

**Efecto práctico:** ahora cada vez que el chofer mira el teléfono se registra
una posición. Eso cubre el caso que dolía (volver y aparecer en el mapa), pero
**un hueco largo con la pantalla apagada sigue siendo ambiguo**.

**Revisar cuando:** si hace falta rastreo confiable con la pantalla apagada y el
camión parado, hay que escribir un servicio nativo que reporte por tiempo, no
por distancia. El plugin actual no lo ofrece.

---

## D-032 · Al chofer le avisan cuando le asignan trabajo

**Fecha:** 2026-08-14 · **Versión:** v1.3.8 · **Pedido por:** Andrés

**Cambio:** cuando se le asigna una parada a un chofer, le llega una
notificación: en la campanita de la app y —si la app está corriendo— como
notificación real del teléfono.

**Razón:** *"quiero que al conductor le caiga una notificación cada vez que se
le asigne una ruta."*

**El hueco que tapa:** las notificaciones existentes se disparaban por **cambio
de etapa** (aprobada, lista, entregada). Que te **entreguen el trabajo** es otro
evento distinto, y era justo el que nadie avisaba: el despachador podía armar el
día completo de un chofer y el chofer solo se enteraba abriendo la app a mirar.

**Un solo punto de enganche:** todas las formas de asignar —el modal, Routes
Manager, el mapa, la asignación masiva— pasan por `updateDelivery`. Poner el
aviso ahí significa que no se puede evadir por ningún camino. Verificado también
que las políticas RLS permiten al despachador escribir una notificación dirigida
al chofer; si no, la función habría quedado muerta en silencio.

**Dos cosas que a propósito NO hace:**

1. **No repite el historial.** Lo que ya estaba en pantalla al abrir se marca
   como visto; un chofer que reabre a mediodía no recibe otra vez la ruta de la
   mañana.
2. **No suena una vez por parada.** El despachador asigna el día entero de un
   golpe; ocho zumbidos en ocho segundos es exactamente como un chofer aprende a
   ignorar la app. Lo que llega junto se junta en un solo aviso ("Se te
   asignaron 3 paradas").

También se omite cuando no hay a quién avisar: al **quitar** la asignación, en
un carril temporal que no corresponde a un usuario real, y cuando el propio
chofer se auto-asigna una orden al recogerla.

**Límite honesto — y es mayor de lo que suena:** la notificación del teléfono
solo sale con la app **en primer plano**. Android congela el JavaScript del
WebView en cuanto el chofer cambia a otra app; se midió en producción que
posiciones capturadas por el código nativo quedaron encoladas **78 minutos**
hasta que la app se reabrió. Es decir: **cambiar de app es casi lo mismo que
cerrarla**, y el zumbido llegaría al volver a la app — justo cuando ya no hace
falta.

Llegarle a un teléfono que nadie está mirando exige **push (FCM)** o un
servicio nativo que consulte por su cuenta; en ambos casos es trabajo nativo y
APK nuevo. La campanita es la mitad confiable y siempre guarda el aviso.

**Revisar cuando:** esto es lo primero que hay que atender si el aviso importa
de verdad — no es un caso raro, es el caso normal.

---

## D-033 · Push real (FCM), para llegarle a un teléfono que nadie está mirando

**Fecha:** 2026-08-14 · **Versión:** v1.4.0 · **Pedido por:** Andrés

**Cambio:** las asignaciones se envían por Firebase Cloud Messaging, así que el
aviso llega con la app en segundo plano, cerrada o el teléfono bloqueado.

**Razón:** *"pero si la app no se cierra, solo cambio de app, ¿me aparecen las
notificaciones?"* — no aparecían. D-032 entregó el aviso por la campanita y una
notificación del navegador, y esa segunda mitad **solo funciona en primer
plano**: Android congela el JavaScript del WebView en cuanto el chofer cambia de
app. Eso no es el caso raro; es el caso normal.

**Por qué FCM y no un servicio que consulte solo:** un consultor nativo
gastaría batería todo el día preguntando "¿hay algo nuevo?" y aun así llegaría
tarde. FCM lo entrega el sistema operativo: cero batería mientras no hay nada,
y llega de inmediato cuando lo hay.

**Sin firebase-admin, a propósito:** la autenticación es firmar un JWT con la
llave de la cuenta de servicio y cambiarlo por un token. Son ~40 líneas contra
arrastrar un árbol enorme de dependencias a una función serverless para una
sola llamada HTTP.

**El envío no acepta destinatario ni mensaje.** `/api/push` recibe **solo el id**
de una notificación que ya existe; el mensaje y a quién va se releen de la base
con el rol de servicio. Así nadie puede usarlo para zumbarle a toda la empresa,
ni para reenviar un aviso viejo (se ignora cualquiera de más de 5 minutos).

**Todo degrada en silencio.** Sin `FIREBASE_SERVICE_ACCOUNT` no hay push, no hay
error, y la campanita —que es el registro— sigue igual. Sin
`google-services.json` el APK **compila igual** y solo avisa en el log; aplicar
el plugin de Google sin ese archivo rompe la compilación de raíz, y una
computadora sin la config de Firebase tiene que poder compilar.

**Consecuencia aceptada:** un token muerto (app desinstalada) se borra, pero
**solo** ante `UNREGISTERED`/`NOT_FOUND`. Un límite de cuota o una caída de
Google **no** borra nada: tratar un fallo temporal como definitivo
desuscribiría a todos los choferes en silencio y nadie se enteraría hasta que
alguien se perdiera una ruta.

**Pendiente del usuario:** crear el proyecto de Firebase con su cuenta,
colocar `google-services.json`, poner `FIREBASE_SERVICE_ACCOUNT` en Vercel y
recompilar el APK. Pasos exactos en `mobile/README.md`.

---

## D-034 · Recorrido del chofer: reconstruido, y honesto sobre lo que no sabe

**Fecha:** 2026-08-14 · **Versión:** v1.4.4 · **Pedido por:** Andrés

**Cambio:** pestaña **Recorrido** (admin / gerente / logística): por chofer y
día, el trazo en el mapa, millas, tiempo manejando, tiempo detenido, las
paradas con su duración, y las órdenes entregadas ese día.

**Razón:** *"hazme el back route del chofer: si se ha movido, qué rutas hizo,
millas recorridas, tiempo en movimiento, tiempo en las tiendas."*

**Es una reconstrucción, no una grabación,** y la pantalla lo dice antes de
mostrar los números. El teléfono reporta cuando el camión **se mueve**, no por
reloj, así que la distancia se mide en línea recta entre puntos sueltos y sale
**menor** que la carretera.

**Lo que se niega a hacer, que es lo importante:**

1. **No adivina en los huecos.** Un tramo sin posiciones puede ser el camión
   parado o la app dormida mientras manejaba (D-031); los datos no distinguen.
   Meter esos minutos en "tiempo en tiendas" inventaría tiempo que el chofer
   nunca pasó parado; meterlos en manejo inventaría millas. Se muestran como
   **"sin determinar"**, con su propio recuadro. El trazo del mapa también se
   **corta** en esos tramos: una línea recta cruzando una hora inexplicada
   sería una carretera que el camión nunca tomó.
2. **No acepta saltos imposibles.** Más de 100 mph entre dos puntos se excluye
   de la distancia y se cuenta aparte, con una bandera roja.
3. **No le pone nombre a una parada** si no hay una dirección conocida a menos
   de 400 m. Una parada sin nombre es honesta; una etiquetada con un cliente
   que está a media milla, no.

**Lo que destapó al primer intento:** correrlo sobre el día real dio **4,936
millas**. Diez posiciones de la cuenta del chofer estaban a ~1,300 millas del
Valle (Honduras), con precisión de 3.6 a 20 m. Sin la regla del salto
imposible, eso se habría promediado dentro de un KPI de kilometraje y nadie lo
habría visto.

> **Resuelto (2026-08-14):** eran **pruebas del propio dueño**, no una segunda
> sesión de un chofer. Las 10 filas se borraron a petición suya; el día real
> quedó en **17.9 millas**. La regla se queda: no dependía de que hubiera algo
> turbio, sino de que un solo punto imposible arruina todos los números que
> vienen después.

**Un falso positivo que salió al limpiar:** con los datos ya buenos seguía
marcando un salto. Eran dos posiciones separadas por **0.30 segundos y 21.7
metros** — temblor de GPS. Dividir entre un tiempo casi cero hace que cualquier
tembleque parezca supersónico. Ahora la prueba de velocidad **solo aplica a
partir de una milla**: un salto que de verdad significa otro dispositivo es de
cientos de millas, nunca de metros.

**Consecuencia aceptada:** con la densidad de datos de hoy, la mayoría de los
días van a salir marcados como bosquejo, y el bloque "sin determinar" será
grande. Es incómodo a propósito: mide qué tan poco sabemos, y es el mejor
argumento para el reporte por tiempo (servicio nativo) que D-031 dejó
pendiente.

---

## D-035 · El rastreo vive sobre las pantallas, no dentro de una

**Fecha:** 2026-08-16 · **Versión:** v1.5.0 · **Pedido por:** Andrés (auditoría)

**Cambio:** el rastreo de posición se movió al layout de la app. Antes corría
dentro de `ShiftClock`, que solo se renderiza en la pantalla de Órdenes.

**Razón:** *"revisa bien la configuración del driver app… con el GPS y así."*

**El defecto, exactamente:** en cuanto el chofer tocaba **"Mi ruta"**, Next
desmontaba la pantalla de Órdenes, se ejecutaba la limpieza del hook,
`removeWatcher()` disparaba y **Android derribaba el servicio en primer
plano** — con el chofer todavía en turno. El camión desaparecía del despacho
hasta que volviera. Y al volver el vigilante arranca de cero: rechaza la
posición cacheada y espera 40 m de movimiento, así que un camión parado se
quedaba invisible mientras siguiera parado.

**Eso explica el reporte de "tardó 45 minutos en decir LIVE otra vez"** mejor
que lo que le atribuimos en D-031. El sueño del JavaScript en segundo plano es
real y está medido, pero **esta causa es nuestra y es mayor**: no hacía falta
ni cambiar de app, bastaba con tocar una pestaña.

**Ahora** solo detienen el rastreo las dos cosas que deben: marcar salida, o
cerrar la app.

**Un chofer previsualizado por un admin no se rastrea:** el layout usa el rol
real del servidor, no el rol que el admin está viendo. Nadie queda geolocalizado
por curiosear una vista.

**Lo demás que se revisó y está bien:** los tres números de versión coinciden
(APK 2), el APK publicado responde, el manifiesto trae los permisos de
ubicación en segundo plano y el servicio declara `foregroundServiceType`, y
Capacitor sí concede geolocalización al WebView cuando la app ya tiene el
permiso — que es de lo que depende el arranque inmediato de D-031.

**Pendiente conocido:** sin `google-services.json` el APK va sin push y hay 0
teléfonos registrados; `versionName` en Gradle quedó en 1.3.5 y conviene
alinearlo en la próxima compilación.

---

## D-036 · Solo el teléfono que marcó entrada reporta

**Fecha:** 2026-08-16 · **Versión:** v1.5.1 · **Pedido por:** Andrés

**Cambio:** el turno guarda **qué teléfono** marcó entrada, y solo ese reporta
posición (migración 050). Además, **un navegador nunca rastrea**: solo el APK.

**Razón:** *"yo me meto en la cuenta de Maximo el conductor, pero si él le dio
clock in, ¿la app va a ser inteligente y solo va a reconocer esa sesión de él?"*
— **No lo era.** La única condición era "rol chofer + turno abierto", así que
**cualquier** dispositivo con esa sesión abierta reportaba.

**Ya había pasado.** Cuando el dueño entró a la cuenta del chofer a probar, su
dispositivo empezó a mandar posiciones: por eso un día salió en **4,936 millas**
con puntos a 1,300 millas de distancia. En su momento lo tratamos como dato
sucio y se borró; la causa de raíz es esta.

**Dos capas, a propósito:**

1. **Vinculación al dispositivo.** Al marcar entrada se guarda un id opaco de la
   instalación (aleatorio, en el almacenamiento local — no es huella digital ni
   identidad). Solo ese teléfono reporta durante ese turno.
2. **Solo el APK.** Un navegador es alguien **revisando**, no alguien
   manejando; además solo el APK puede reportar con la pantalla apagada. Esto
   deja fuera para siempre a la laptop de la oficina.

**Desconocido = permisivo, y es deliberado:** un turno abierto antes de que
existiera la columna, o un teléfono que no puede guardar almacenamiento local,
siguen rastreando igual. Dejar a oscuras a un chofer real a media ruta sería
peor que la mezcla que esto evita.

**Consecuencia aceptada:** si el chofer reinstala la app a media jornada, su id
cambia y deja de reportar hasta que vuelva a marcar entrada. Es el precio de que
el rastro corresponda a **un** camión.

---

## D-037 · El GPS reporta por reloj, no solo por movimiento

**Fecha:** 2026-08-16 · **Versión:** v1.5.3 · APK 3 · **Pedido por:** Andrés

**Cambio:** el código nativo entrega una posición **cada 2 minutos**, se mueva o
no el camión, además del reporte por distancia que ya existía.

**Razón:** *"haz lo del GPS por tiempo."* Cada día salía con ~390 minutos "sin
determinar" en el Recorrido, porque un camión parado no reportaba nada y un
hueco podía ser tanto una parada como la app muerta.

**El hallazgo que lo hace obvio:** leyendo el plugin, en Android hace esto:

```java
locationRequest.setInterval(1000);                       // pide GPS CADA SEGUNDO
locationRequest.setPriority(PRIORITY_HIGH_ACCURACY);     // a máxima precisión
locationRequest.setSmallestDisplacement(distanceFilter); // pero solo ENTREGA a 40 m
```

**El GPS ya venía corriendo a tope cada segundo.** El filtro de 40 m no ahorraba
batería: solo **tiraba** posiciones ya calculadas. Los 390 minutos no eran
desconocidos, eran descartados. Esto no gasta más batería — deja de tirar lo
que ya se paga.

**Por qué nativo y no un temporizador de JavaScript:** el latido anterior era un
`setInterval`, y Android **suspende** esos temporizadores en cuanto la app pasa
a segundo plano — justo cuando más falta hacía. Ahora el pulso viene de código
nativo que sigue corriendo; los eventos se encolan y se vacían al despertar
**con su hora de captura intacta**, así que el rastro queda bien aunque la
subida llegue a ráfagas.

**Se ofrece cada 2 min, se guarda cada 5:** cada posición pasa igual por el
filtro de envío, así que un camión parado escribe una fila cada 5 minutos
(~100 filas por jornada). Ofrecer más seguido de lo que se guarda sirve para
otra cosa: un camión que arranca se nota a los 2 minutos, no a los 5.

**Consecuencia aceptada:** más filas y una subida en ráfagas cuando el teléfono
estuvo dormido. A cambio, un hueco largo por fin **significa algo** — sin señal,
o app caída — en vez de ser indistinguible de una parada normal.

**Pendiente del usuario:** es nativo. Requiere compilar y subir el **APK 3**.

---

## D-038 · Entrar con usuario, para quien no tiene correo

**Fecha:** 2026-08-16 · **Versión:** v1.6.0 · **Pedido por:** Andrés

**Cambio:** un usuario se puede crear con **nombre de usuario en vez de correo**,
y el admin puede editar usuario y correo de cualquiera desde Usuarios. La
pantalla de acceso acepta las dos formas.

**Razón:** *"déjame editar username, emails y así en user; si quiero, en vez de
un email crear un username."*

**El problema real:** Supabase identifica a las personas por correo y eso no se
negocia. Almacén y choferes rara vez tienen dirección de empresa, así que la
oficina terminaba **inventándoles correos** que después nadie recuerda.

**La solución:** quien no tiene correo recibe uno **sintético derivado** de su
usuario — `maximo` entra como `maximo@users.rdztilegroup.net`.

**Derivado, no consultado, y eso es lo importante:** la pantalla de acceso
construye la dirección sola. Así **no existe ningún endpoint que conteste "¿este
usuario existe?"**, y por lo tanto no hay nada que sondear para sacar la lista
de quién trabaja aquí.

**El costo, y es real:** una persona sin correo **no puede restablecer su propia
contraseña**. Ningún enlace puede llegarle; un admin tiene que ponerle una
nueva. La app lo dice **al crear la cuenta**, no el día que se le olvide.

**Dos reglas que evitan un bloqueo silencioso:**

1. **Renombrar el usuario mueve también la dirección de acceso**, pero **solo si
   era derivada**. Reescribir un correo real porque alguien editó un campo de
   usuario sería robarle la cuenta a esa persona.
2. **Un correo real siempre gana** sobre el usuario: dar una dirección de verdad
   es también devolverle a esa persona la capacidad de recuperar su contraseña.

**Consecuencia aceptada:** el usuario se valida angosto (3–30, letras, dígitos,
punto, guion, guion bajo). Se vuelve la parte local de una dirección, y algo
exótico ahí produce una cuenta que se ve bien y **no puede entrar**.

---

## D-039 · Registro de cambios de acceso

**Fecha:** 2026-08-16 · **Versión:** v1.7.0 · **Pedido por:** Andrés

**Cambio:** Un registro aparte anota quién cambió roles, permisos, usuario y correo, y quién restableció contraseñas. Se ve en Auditoría, solo para admins.

**Razón:** registro de seguridad: quién cambió el acceso de alguien y cuándo

**Consecuencia aceptada:** Un admin podía restablecer contraseñas, cambiar correos y roles, y NADA quedaba escrito. La Auditoría solo cubría órdenes, así que la pregunta “¿quién le cambió el rol a esta persona?” no tenía respuesta. Es angosto a propósito: solo lo que cambia qué puede alcanzar alguien o cómo entra — un registro que anota todo no lo lee nadie. Nunca guarda una contraseña: el registro es que HUBO un restablecimiento, no lo que produjo. Es de solo lectura por construcción, y se verificó en vez de suponerse: se sembró una fila y, actuando como admin, se corrió DELETE y UPDATE sobre toda la tabla — ambos devolvieron sin error (RLS afecta cero filas en silencio) y la fila sobrevivió intacta. Un admin tampoco puede firmar una entrada a nombre de otro. El nombre de quien fue eliminado se guarda en la fila y no se busca después: su perfil se va con la cuenta, y esa entrada es la que más vale poder leer meses después.

---

## D-040 · Las fotos dicen quién las tomó

**Fecha:** 2026-08-16 · **Versión:** v1.7.2 · **Pedido por:** Andrés

**Cambio:** Cada foto muestra el nombre y el puesto de quien la subió, sobre la miniatura y en el visor.

**Razón:** *"cuando alguien suba foto que aparezca quien la subio y el puesto"*

**Consecuencia aceptada:** El campo de fotos era una lista de URLs y nada más, así que ninguna imagen tenía autor. El registro de actividad anota que “photos” cambió y por quién, pero no CUÁL foto — FQ114 tiene seis de esas entradas del mismo chofer en diez minutos, y no había forma de ligar un nombre a ninguna. Se estampa en el proveedor y no en cada pantalla: la tarjeta del chofer, la hoja de entrega y la vista de oficina escriben por el mismo punto, y una atribución que depende de acordarse de agregarla es una que se pierde. El nombre y el puesto se resuelven AL MOSTRARLOS, no se congelan en la fila: el pie debe decir lo que la persona ES, no lo que decía su puesto el día que apretó el botón. Las fotos anteriores quedan sin pie, no con uno inventado.

---

## D-041 · Las fotos se abren y se pueden acercar

**Fecha:** 2026-08-16 · **Versión:** v1.7.3 · **Pedido por:** Andrés

**Cambio:** Tocar una foto abre un visor a pantalla completa con zoom (pellizco, doble toque, rueda o botones), desplazamiento y flechas entre fotos. La firma de una entrega también.

**Razón:** *"le doy click a la foto y no me abre, quiero que me abra como pop up y hasta me deje darle zoom"*

**Consecuencia aceptada:** Tocar la foto llamaba a window.open, que dentro del WebView de Android no hace absolutamente nada: sin manejador de popups, sin pestaña nueva y sin error. La foto simplemente no era clicable justo en el dispositivo donde una foto de entrega importa. El zoom se implementó en vez de dejárselo al navegador porque un WebView con viewport fijo no hace pinch sobre un elemento de la página, y la foto es exactamente lo que alguien necesita agrandar: un número de lote, una esquina golpeada, un remito. El zoom se reinicia al pasar de foto — arrastrarlo deja al lector en medio de una imagen que todavía no ha visto. La firma se mostraba a 90px de alto y sin clic, que no es un tamaño al que nadie pueda verificar una firma.

---

## D-042 · La selección múltiple es para quien despacha

**Fecha:** 2026-08-16 · **Versión:** v1.7.6 · **Pedido por:** Andrés

**Cambio:** Se quitó la columna de casillas a vendedor y contabilidad. La conservan admin, gerente y logística.

**Razón:** *"quitale a ellos, a vendedor y accounting"*

**Consecuencia aceptada:** Vendedor la tenía para UNA sola acción (enviar a aprobación) — toda una columna de pantalla para un botón. Contabilidad la tenía para aprobar, cancelar y fijar fecha, que son decisiones que conviene tomar orden por orden y no de ocho en ocho. Ninguno pierde capacidades: las siguen teniendo desde la orden misma. También se quitó a contabilidad de esos tres botones de la barra, porque sin casilla ya no puede seleccionar nada y las ramas quedaban inalcanzables — le habrían dicho al siguiente que lea el código que contabilidad aprueba en lote. Chofer y almacén nunca la tuvieron: todos los controles de la barra están reservados a roles de oficina, así que la columna seleccionaría filas sobre las que no podrían actuar.

---

## D-043 · Fuera la satisfacción del cliente

**Fecha:** 2026-08-16 · **Versión:** v1.7.7 · **Pedido por:** Andrés

**Cambio:** Se quitaron las estrellas y el comentario de la orden, y los cinco indicadores que los mostraban.

**Razón:** *"en el view de ordenes se sigue viendo lo de satisfaccion del cliente"*

**Consecuencia aceptada:** Se verificó antes de borrarlo: 0 de 53 órdenes han tenido alguna vez calificación o comentario. Nunca se usó. Sin forma de capturarla, los indicadores solo podían mostrar un guion para siempre, así que se fueron con ella: el recuadro de flota, la línea de tendencia, la columna por chofer, la celda de promedio y “% Calif.” en la tabla de calidad, más sus tres columnas del CSV. Las columnas csat_rating y csat_comment se quedan en la base, así que no se pierde nada si vuelve. Quitar celdas de tablas es donde este tipo de cambio se rompe, así que se contaron después en vez de confiar en la compilación — aparecieron dos huérfanos que TypeScript y el build aceptaron sin quejarse: un encabezado sin celda debajo, y la estrella del promedio de flota escondida en la fila de totales.

---

## D-044 · Contabilidad revisa y aprueba; no crea

**Fecha:** 2026-08-16 · **Versión:** v1.8.0 · **Pedido por:** Andrés

**Cambio:** Contabilidad ya no ve el enlace de seguimiento del cliente, ni el botón Duplicar, ni puede crear órdenes.

**Razón:** *"el de contabilidad no tiene que ver eso de copiar enlace / y de hecho ellos tampoco pueden duplicar ordenes ni crear"*

**Consecuencia aceptada:** El enlace de seguimiento es herramienta de ventas y despacho: contabilidad factura la entrega, no le dice al cliente dónde va el camión. Crear y Duplicar salían de la misma capacidad, así que quitar “create” del rol eliminó ambos, más el “+ Nueva orden” y el envío masivo a aprobación. Eso resultó ser un desajuste entre interfaz y base de datos, no un cambio de política: se simuló un alta como contabilidad contra la base real y SIEMPRE estuvo prohibida — “Only sales, managers or drivers can create orders”. La app ofrecía dos botones que la base reventaba, y la descripción del rol decía “Como Oficina” y listaba “Crear órdenes” entre sus permisos. Ninguna de las dos cosas era cierta.

---

## D-045 · El PO es obligatorio en Intertienda

**Fecha:** 2026-08-17 · **Versión:** v1.8.6 · **Pedido por:** Andrés

**Cambio:** una orden Intertienda no se puede enviar sin **PO #**. Con eso, se
auto-aprueba como cualquier otra.

**Razón:** *"todas las tiendas están de auto approved pero no pasó hoy con unas
órdenes que agregaron."*

**Lo que estaba pasando:** existía una regla —**sin registrar en esta
bitácora**— que decía que una Intertienda sin PO no se auto-aprueba y se va a
Pendiente. Pero la validación de campos pedía otra cosa: *"cualquiera de PO # /
SO # / Factura #"*. Así que una Intertienda con solo factura **pasaba la
validación** y luego fallaba la otra regla, cayendo en Pendiente **sin ninguna
explicación**. Dos reglas discutiendo sobre la misma orden.

**Cuánto costaba:** las 7 órdenes Intertienda del 17 de agosto (FQ501, FQ503 a
FQ508) quedaron pendientes y alguien las aprobó a mano, una por una. En el
histórico, de 24 Intertienda solo 10 traían PO — 14 pasaron por ese trámite.
Y desde afuera se veía como si el auto-aprobado estuviera roto, que es
exactamente lo que se reportó.

**Por qué obligatorio y no quitar la regla:** el dueño lo eligió así. Si el PO
importa para contabilidad en las transferencias entre tiendas, pedirlo al
crear es más barato que perseguirlo después — y elimina la categoría entera de
"quedó pendiente y nadie sabe por qué".

**Cómo se implementó:** una regla de documento nueva, `docRef: "po"`,
configurable desde la página de Datos como las demás. No quedó escondida en el
código: un admin puede cambiarla si mañana la política cambia.

**Consecuencia aceptada:** si el PO todavía no existe cuando se captura la
orden, no se puede enviar — hay que guardarla como borrador y volver. Es el
precio de que ninguna quede detenida en silencio.

---

## D-046 · La documentación viva se mantiene en Notion
**Fecha:** 2026-08-18 · **Versión:** v1.9.2 · **Pedido por:** Andrés

**Cambio:** el estado del proyecto se documenta en Notion, y actualizarlo pasa a
ser parte de cada cambio de código, no una tarea aparte. Seis secciones:
Arquitectura, Estado actual, Setup, Decisiones (ADR), Changelog y Próximos
pasos. La regla quedó escrita en `CLAUDE.md` para que una sesión nueva del
asistente la recoja sin que nadie se la repita.

**Razón (textual):** *"tan completa que si pierdo el historial del chat,
cualquier persona (o tú mismo en una sesión nueva) pueda entender el estado
completo de la app y continuar el trabajo solo leyendo Notion"*.

El problema real: casi todo el porqué de este sistema vivía en un historial de
chat. El repositorio dice qué hace el código, nunca qué se descartó ni por qué.
Perder ese hilo significaba volver a discutir decisiones ya tomadas.

**Por qué Notion y no solo archivos en el repo:** la gente de operaciones no
abre GitHub. `DECISIONS.md` sigue siendo el original de los ADR — Notion es su
espejo consultable, filtrable y compartible.

**Por qué bases de datos para ADR y Changelog:** son las dos cosas que solo
crecen. Como base se filtran por fecha, versión y área; como página serían un
muro de texto imposible de recorrer a los seis meses.

**Consecuencia aceptada:** hay dos lugares que mantener sincronizados, y una
documentación a medio actualizar miente peor que no tener ninguna. Por eso la
regla es "en la misma sesión", no "cuando se pueda".

**Revisar cuando:** si el mantenimiento se empieza a saltar, la salida es
generar el Changelog desde `git log` automáticamente en vez de a mano.

---

## D-047 · Push notifications activadas
**Fecha:** 2026-08-18 · **Versión:** v1.9.3 · **Pedido por:** Andrés

**Cambio:** las notificaciones push (FCM) dejan de estar inertes. Se creó el
proyecto de Firebase `rdz-deliveries`, se agregó `google-services.json` al
módulo Android y `FIREBASE_SERVICE_ACCOUNT` a Vercel (producción, preview y
desarrollo). Se compiló y publicó el APK 4 con el plugin de Google Services
aplicado.

**Razón:** el código de push llevaba semanas escrito y probado, solo inerte
por falta de las credenciales de Firebase. Sin push, un chofer con la app
cerrada no se enteraba de una asignación nueva hasta volver a abrirla — el
hueco funcional más grande que quedaba en producción.

**Consecuencia aceptada:** hay **0 teléfonos con token registrado** todavía.
El registro pasa solo cuando alguien abre la app instalada desde el APK 4 —
hasta que Maximo actualice, el comportamiento sigue siendo el de antes.

**Revisar cuando:** una vez que haya teléfonos registrados, confirmar en la
consola de Firebase que los envíos llegan y no solo se aceptan.

---

## D-048 · Sentry conectado (errores + tracing)
**Fecha:** 2026-08-18 · **Versión:** v1.9.4 · **Pedido por:** Andrés

**Cambio:** se instaló `@sentry/nextjs`, con `instrumentation.ts` /
`instrumentation-client.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`,
`src/app/global-error.tsx`, y `next.config.mjs` envuelto en `withSentryConfig`.
El `ErrorBoundary` de la app ya no solo loguea a consola: manda la excepción a
Sentry con el rol del usuario y el build de APK como tags. Alcance deliberado:
solo errores + tracing (10% de las requests, 100% en desarrollo) — nada de
Session Replay, Logging ni Profiling todavía, para no instrumentar de más en
una instalación nueva.

**Razón:** hasta hoy, un error en la app del chofer se quedaba en la consola
de su teléfono — nadie se enteraba salvo que el chofer describiera lo que vio.
Motivado directamente por el crash de Maximo ("RDZ Deliveries keeps
stopping") del mismo día: sin Sentry, no había forma de saber qué lo causaba
sin acceso físico al teléfono.

**Consecuencia aceptada:** `SENTRY_ORG`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`
y `SENTRY_AUTH_TOKEN` ya están en Vercel; falta `SENTRY_PROJECT` (el slug del
proyecto en Sentry) para que el build suba source maps — sin eso, la
compilación avisa y sigue sin romperse, pero los stack traces de producción
llegan minificados hasta que se agregue. Se agregó `@sentry/nextjs` como
dependencia de producción, la primera excepción a la regla de las siete
dependencias — se aceptó porque no hay alternativa razonable de ~40 líneas
como con FCM.

**Revisar cuando:** llegue `SENTRY_PROJECT` — agregarlo a Vercel activa las
dos advertencias que hoy imprime el build.

**Nota (2026-08-18, mismo día):** `SENTRY_PROJECT=javascript-nextjs` ya está en
Vercel. El build confirmado subiendo source maps sin advertencias, y un error
de prueba disparado a través de la app real (no un script aparte) llegó al
dashboard. Cerrado.

---

## D-049 · Pallets y documento bloquean de verdad al enviar a aprobación
**Fecha:** 2026-08-18 · **Versión:** v1.9.5 · **Pedido por:** Andrés

**Cambio:** una orden ya no puede pasar de `draft` a `pending` (ni de
`rejected` a `pending`, el mismo botón de reenviar) si le falta el número de
pallets (`est_pallets`, debe ser > 0) o el documento que le corresponda según
su tipo (PO/SO/Factura — la regla de D-045, sin tocar). Nuevo:
`submitBlockers()` en `src/lib/required.ts`, un subconjunto de
`missingFields()` que en vez de listar-y-dejar-continuar, **rechaza** con un
mensaje que dice exactamente qué falta. Guardar como borrador sigue sin pedir
nada — eso no cambió.

**Razón:** reportado en modo de entrenamiento: una orden se envió a
aprobación sin pallets. Investigando se encontró que la causa no era el modo
de entrenamiento — es que había **dos caminos distintos** para llegar a
Pending, y solo uno de los dos validaba, y ese validaba con un diálogo
"¿Continuar de todos modos?" que cualquiera podía aceptar sin corregir nada:

1. Crear una orden nueva y enviarla directo → pasaba por `passesChecks()`,
   que ya calculaba `missingFields()` (pallets estaba ahí desde antes) pero
   solo como advertencia descartable.
2. Abrir un borrador ya guardado y tocar "Enviar a aprobación" → llamaba a
   `move("pending")`, que iba derecho a `setStage()` **sin pasar por
   ninguna validación**, ni siquiera la advertencia descartable.

El segundo camino es casi seguro por dónde pasó esta orden: se guarda como
borrador (sin pedir nada, correcto), se reabre después, y "Enviar a
aprobación" no revisaba nada en absoluto.

**Por qué bloquea al enviar y no al guardar borrador:** un borrador existe
para guardar algo incompleto y volver (D-004, D-045); exigir todo desde el
guardado inicial volvería a atorar órdenes que alguien está armando a medias.
El bloqueo se agregó en el único lugar por el que pasan los dos caminos hacia
Pending (`passesChecks()` para crear/editar, y directamente en `move()` para
el botón de reenviar), reutilizando `missingFields()` en vez de duplicar la
lógica del documento por tipo.

**Por qué NO se hizo la factura obligatoria por sí sola:** no era lo pedido,
y forzarla revertiría D-045 (8 de 41 órdenes históricas no traen factura al
crearse) — seguiría aceptando PO o SO en su lugar, sin cambios en esa regla.

**Consecuencia aceptada:** el resto de los campos requeridos (contacto,
teléfono, direcciones, fecha, ventana, costo de entrega) **siguen siendo
advertencia descartable**, no bloqueo — fuera del alcance de este reporte. Es
un solo punto de aplicación en la interfaz (`OrderModal.tsx`), no en cada
proveedor de datos: los dos proveedores (`data-provider.tsx` y
`local-data-provider.tsx`) nunca validaron campos en `setStage`, solo la
legalidad del cambio de etapa — la validación de campos siempre vivió en la
interfaz, así que arreglarla ahí cubre ambos modos (y el modo de
entrenamiento) sin duplicar nada.

**Tests:** `src/lib/required.test.ts` — nueve casos nuevos para
`submitBlockers()`: vacío en una orden completa, pallets null, pallets = 0,
factura vacía, Intertienda sin ningún documento, costo de entrega NO bloquea,
contacto/teléfono/dirección NO bloquean, ambos a la vez se reportan juntos, y
Transfer (sin papeleo) bloquea solo por pallets. No hay test a nivel de
componente para "guardar borrador no pide nada" — esa garantía es el guard
`stage !== "draft"` ya existente en `OrderModal.tsx`, y el proyecto no tiene
un patrón establecido de pruebas de componente para `OrderModal.tsx` (las 445
pruebas anteriores son todas de `src/lib`, sin React).

---

<!-- PLANTILLA — copia esto para una entrada nueva
## D-0XX · Título corto en presente
**Fecha:** YYYY-MM-DD · **Versión:** vX.Y.Z · **Pedido por:** nombre

**Cambio:** qué hace distinto el sistema ahora.

**Razón:** por qué se pidió. Textual cuando se pueda.

**Consecuencia aceptada:** qué se sacrificó a cambio.

**Revisar cuando:** (opcional) qué haría que esta decisión caduque.
-->
