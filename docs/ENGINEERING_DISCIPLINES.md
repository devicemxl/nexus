# Disciplinas de ingeniería

**Estado:** documento vivo
**Alcance:** prácticas de método del proyecto Nexus, acumuladas por evidencia

Las disciplinas de este documento no son preferencias de estilo. Cada una nació
de un defecto concreto que se escapó, o de una decisión que se tomó sin
evidencia y hubo que rehacer. Se registran aquí para que el costo se pague una
sola vez.

Cada entrada lleva el episodio que la originó. Si el episodio deja de ser
relevante, la disciplina se revisa; no se conserva por inercia.

---

## En vigor desde Fase 0

### D-1 — Scope congelado por unidad de trabajo

Cada widget, escena o componente declara su alcance antes de empezar. Si
durante la construcción aparece una necesidad no listada, se anota como deuda y
se decide explícitamente si entra ahora o se difiere. No se amplía el alcance
en silencio.

*Origen:* Punto 6 de Fase 0, ejercicio de validación con widgets canónicos.

### D-2 — Dos usos antes de estabilizar una API de ayuda

Un helper no se promueve a superficie estable hasta que exista un segundo caso
real que lo consuma. Un solo uso no distingue la forma correcta de la forma que
resultó conveniente esa vez.

*Origen:* Punto 6 de Fase 0. Es la razón por la que `WIDGET-COMPOSITION` sigue
diferido: la forma del helper debe emerger de widgets reales.

### D-3 — Orden de trabajo

Mini-spec antes de código. Harness antes de widget. Evidencia antes de
decisión. Deuda registrada antes de olvidarse.

*Origen:* `PROJECT_ROADMAP.md` §4 de las notas de cierre.

### D-4 — Descarte documentado

Una investigación que termina sin cambio se registra igual, con lo que se
intentó y por qué se cerró. La sección *Not Debt (Recorded for Clarity)* de
`PHASE_0_DEFERRED.md` existe para eso.

*Origen:* §7 de `PULSAR_R1_FIX.md`. Se sospechó un cuarto defecto en `_notify`,
se intentó reproducir por tres vías y ninguna lo expuso. Sin el registro, la
siguiente lectura del código habría gastado el mismo tiempo en llegar a la
misma conclusión.

---

## Añadidas en Fase 1

### D-5 — Un verde en entorno sustituto no es evidencia de corrección

El entorno sustituto (Node, un shim de DOM) es un instrumento para iterar sin
abrir el navegador en cada cambio. El registro canónico viene del entorno
objetivo.

Un verde en el sustituto significa **"la condición no se ejercitó"**, no "el
código es correcto".

*Origen:* Escena 1.2. `validar-modelo.mjs` daba 52/52 verdes sobre un defecto
de ordenamiento. Node era lo bastante lento como para que dos creaciones
consecutivas nunca compartieran marca de `Date.now()`, así que la condición que
disparaba el defecto no se daba nunca. El navegador lo encontró en la primera
corrida, y con resultados distintos en cada recarga.

*Corolario:* cuando un defecto puede depender de tiempo, resolución,
concurrencia o recursos, el sustituto es sistemáticamente ciego. En esos casos
se fuerza la condición adversa de forma explícita — la batería de la Escena 1.2
se ejecuta también con `Date.now()` congelado, que es el peor engrosamiento
que un navegador puede aplicar.

*Segundo episodio, de otra forma:* Escena 1.3. Aquí el sustituto no se calló,
midió — y se equivocó en la tendencia, que es peor que equivocarse en la
magnitud. Comparando el coste de reconstruir una lista frente a escribir un
nodo, con M mensajes en pantalla:

| M | Node estimó | navegador midió |
|---|---|---|
| 10 | ×6 | ×5 |
| 50 | ×7 | ×15 |
| 200 | ×24 | ×26 |
| 500 | ×8 | ×32 |

La serie de Node es errática: sube a ×24 y baja a ×8. La del navegador crece
limpiamente con el tamaño. Sin layout ni pintado, el sustituto medía otra cosa.
Fiándose del ×8 a 500 mensajes se habría concluido que la diferencia deja de
importar justo donde empieza a importar de verdad.

*Regla que se sigue de ambos episodios:* antes de medir, decidir si la magnitud
que interesa existe en el sustituto. El coste en JavaScript puro sí; el coste
de layout, pintado, red o entrada del usuario, no. Lo que no existe ahí no se
mide ahí, ni siquiera "para orientarse".

*Contrapeso, para no sobrecorregir:* el sustituto no es el entorno pobre. Es
otro entorno, con otras capacidades, y a veces puede lo que el objetivo no.

Escena 1.4. Probar la navegación exige controlar `location`, `history` y los
eventos de la ventana. En Node se fabrica una ventana entera y se ejercita el
Voyajer real. En el navegador no: la única ventana disponible es la de la
propia página del harness, y usarla significaría cambiar su URL mientras se
prueba. Ahí el harness de navegador usa un Voyajer simulado y la integración
real la cubre Node.

El reparto no es una concesión: cada entorno cubre lo que el otro no puede.
Node puede fabricar una ventana entera; el navegador no puede prestar la suya
sin ensuciarse.

### D-6 — Toda aserción protectora debe demostrarse capaz de fallar

Después de escribir una aserción que protege un invariante, se rompe el
invariante a propósito y se confirma que la aserción se pone en rojo. Una
aserción que nunca se vio fallar es decoración.

**Cuántas se ponen en rojo es información en sí misma.** Si romper una cosa
enrojece veinte aserciones, esas veinte no son independientes. Si enrojece
exactamente las que describen esa cosa, la batería está bien particionada.

*Origen:* cuatro episodios consecutivos.

- R-1: con `pulsar.js` v0.2.1 el harness daba 26/33, y los 7 rojos eran
  exactamente el grupo R-1.
- Escena 1.1: invertir el orden de arranque enrojece **una** aserción. Las
  otras 23 siguen verdes porque el orden invertido es funcionalmente correcto.
  Sin esa aserción concreta, la regresión sería invisible.
- Escena 1.2: invertir el desempate del orden enrojece exactamente dos.
- Escena 1.3: meter el texto en la firma estructural enrojece exactamente tres.

**Cuando nada se pone en rojo, el hallazgo no es que sobre la aserción: es que
la explicación era falsa.**

*Origen de este añadido:* Escena 1.4. El adapter de ruta llevaba una guarda que
—según la mini-spec y según su propio comentario— cortaba el bucle entre la URL
y el estado de interfaz. Al borrarla, las 47 aserciones siguieron verdes.

La conclusión no fue "la aserción está mal escrita" sino "lo que afirmaba el
comentario no es cierto". Medido, el bucle lo cortan otros dos mecanismos: la
idempotencia de `push` y la `equality` del selector. La guarda hacía algo real
pero distinto —ahorraba un `setState` por selección, 2 en vez de 3— y ese
número sí se puede afirmar.

Una línea cuyo efecto no se mide es una línea que alguien borrará con razón, y
un comentario que la justifica mal es peor que ninguno: convierte una economía
en una garantía imaginaria de la que otros dependerán.

### D-7 — El defecto funcionalmente correcto necesita instrumentación propia

Hay invariantes que no son sobre el resultado: coste, orden de operaciones,
liberación de recursos, número de llamadas. Ninguna aserción sobre la salida
los detecta, porque la salida es correcta.

Esos invariantes necesitan su propia instrumentación, y son precisamente los
que degradan en silencio.

*Origen:* Escena 1.1. Hidratar después de montar los adapters convierte el
arranque de O(N) en O(N²), pero produce una proyección **idéntica byte a
byte**. Ninguna aserción funcional podía verlo. Hizo falta contar las llamadas
a `setState` y afirmar que el conteo no depende del tamaño del snapshot.

*Criterio práctico:* si un cambio puede empeorar el sistema sin cambiar ninguna
salida observable, hace falta una aserción que no mire la salida.

### D-8 — Una contradicción aparente se verifica contra el changelog

Antes de declarar que dos documentos se contradicen, se lee el encabezado y el
changelog de ambos. Un proyecto con documentos versionados registra sus
supersesiones; una contradicción suele ser una supersesión ya declarada que no
se leyó.

*Origen:* al abrir Fase 1 se diagnosticó como incoherencia que
`PHASE_0_CLOSURE.md` §4 y `PROJECT_ROADMAP.md` discreparan sobre el objetivo de
Fase 1. El roadmap declaraba la supersesión explícitamente en su línea 11,
incluida la decisión de no editar el closure por ser inmutable por diseño. La
pregunta estaba contestada antes de formularse, y la corrección propuesta
habría violado una decisión vigente.

---

## Cómo se añade una disciplina

Cuando un defecto se escapa o una decisión se toma sin evidencia y hay que
rehacerla, se pregunta si el episodio es repetible. Si lo es, entra aquí con su
origen. Si fue circunstancial, no.

Una disciplina sin episodio que la origine es una opinión, y este documento no
las colecciona.
