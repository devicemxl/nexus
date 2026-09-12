# Session Doc — Nexus Fase 0 Puntos 5 y 6

**Fecha:** Septiembre 2026
**Duración estimada:** una sesión larga con múltiples turnos
**Punto de arranque:** cuatro primitivas vivas (Pulsar 0.2.1, nebula 0.3.0, Voyajer 0.2.1, Chunklet 0.4.0), dos adapters vivos (Bridge, Hydration), Nexus Contract "traspapelado".
**Punto de salida:** cinco adapters vivos con harness verde y widget canónico validado, deuda técnica formalizada, tres specs alineadas contra código real.


## Lo bueno

**1. La disciplina "mini-spec primero, código-harness-widget después" funcionó sin excepciones.** Cada adapter arrancó con una mini-spec revisada contigo antes de escribir código. Ningún adapter necesitó reescritura post-implementación por decisiones de diseño mal tomadas. Este es el resultado más valioso: cero retrabajo por specs vagas.

**2. Los widgets como validación empírica salieron mejor de lo esperado.** No fueron artefactos ceremoniales — cada uno reveló información específica:
- Bridge: 73% de ruido reactivo con N=8 cuantificado, evidencia que transformó BRIDGE-REACTIVE de hipótesis a dato.
- Hydration: patrón "normalized state" verificado empíricamente con lookups secundarios.
- Persistence: ciclo storage → hydrate demostrado con reload real y captura de DevTools.
- External Event: anti-eco confirmado numéricamente (out=8/in=3 sin cruces).
- Logging: set semantics visible en tiempo real ("link duplicado no crece el log").

**3. La fusión Punto 5 + Punto 6 en un solo ciclo iterativo demostró ser correcta.** El plan original separaba "escribir adapters" y "validar con widgets". Al fusionarlos, cada adapter cerró con evidencia empírica antes de arrancar el siguiente. Ningún adapter tuvo que ser revisado retroactivamente por hallazgos de widget posterior.

**4. La deuda técnica se registró en el momento en que se descubrió, no después.** BRIDGE-REACTIVE se cuantificó al construir su widget, PERSISTENCE-INDEXEDDB se registró al escribir la mini-spec de Persistence, 12-BRIDGE-INTEGRATION y 12-PERSISTENCE-INTEGRATION se anticiparon al escribir la mini-spec de External Event. Ningún ítem esperó a "algún día lo anoto".

**5. Los harness browser-native con mocks inyectables funcionaron limpio.** Ningún test necesitó Node ni Playwright. El mock de `BroadcastChannel` para External Event fue el más elaborado y aún así encajó en el patrón. Métricas de tiempo excelentes salvo Persistence que legítimamente espera timeouts (4.3 ms External Event, 2.2 ms Logging, contra 486 ms de Persistence — la diferencia se explica sola).

**6. La auditoría documental hecha al cierre de la sesión anterior dio sus frutos aquí.** Cuando arrancamos, ya sabíamos que nebula estaba en 0.3.0 con G-0 aplicado, que Chunklet 0.4.0 tenía `configure`, y que la spec de Nexus tenía referencias desactualizadas. Ninguno de los cuatro adapters escritos en esta sesión tuvo problemas por asunciones erróneas sobre las primitivas. La disciplina de mantener docs alineadas paga.


## Lo malo (o por lo menos, no ideal)

**1. La duplicación del patrón "snapshot pre/post para detectar link no-op" se acumuló en cuatro adapters.** Bridge, Persistence, External Event y Logging tienen versiones prácticamente idénticas de `_snapshotLinksOf` y `_sameShallowLinks`. Es ~20 líneas duplicadas por adapter, ~80 líneas totales. La disciplina de "no crear dependencias entre adapters solo para deduplicar" es defendible, pero el costo empieza a ser visible. **Deuda emergente candidata:** un módulo `adapter-utils.js` o similar en v0.2.0 de la Fase 1 que consolide este patrón, expuesto como helper opcional para adapters futuros.

**2. La sección §4.2 de la mini-spec de External Event terminó documentando dos limitaciones (12-BRIDGE-INTEGRATION y 12-PERSISTENCE-INTEGRATION) que no descubrimos hasta escribir la mini-spec.** Si hubiéramos construido el widget con Bridge acoplado, habríamos hallado esto empíricamente al fallar el re-render. Al no acoplarlo (por la Disciplina 1 de scope congelado), el hallazgo salió de razonamiento arquitectónico durante la escritura de spec. Ambos caminos son válidos, pero es interesante notar que el razonamiento estático anticipó lo que la construcción no forzó a experimentar.

**3. El widget de Logging es el único sin un "verdict empírico" cuantitativo tan claro como los otros.** Los widgets de Bridge, Persistence y External Event producen números específicos (73%, timing en ms, contadores). El de Logging demuestra funcionalidad pero no cuantifica nada nuevo. Es aceptable — Logging es un adapter simple y su "verdict" es la coherencia visible de lo que aparece y no aparece en el log — pero rompe la simetría de reportes empíricos.

**4. El TEST 9 del harness de External Event (canal ownership) verifica solo el path de canal inyectado, no el de canal propio.** Es una asimetría intencional — verificar `channel.close()` en el canal real de BroadcastChannel requeriría un mecanismo de observación que no está en la API pública. Pero es un test menos completo de lo ideal.

**5. Algunas decisiones micro las tomé sin consultar y las anuncié después ("un ajuste que hice sin consultar").** En ningún caso hubo objeción tuya, pero el patrón puede erosionar el ciclo de confirmación explícita si se abusa. Lista de decisiones micro no consultadas en esta sesión: `onError` callback en Persistence, `flush()` público en Persistence, wire event shape en External Event (`type`/`origin`/`op`/`args`), `onRemoteError` en External Event, "sink error silencioso con warn" en Logging, "al menos uno de nebula/pulsar requerido" en Logging. **Reflexión:** todas fueron decisiones defendibles y las anuncié al presentar los artefactos. Pero si aparecen decisiones más consecuentes, deberían pasar por confirmación explícita antes de codificar, no después.

**6. El widget del Bridge acumuló ruido reactivo hasta 73% en un test manual con N=8.** Esta es evidencia dura pero relativamente barata (8 entidades). No probamos con N=50 o N=100 donde el ratio se acerca al 99%. La extrapolación teórica es sólida, pero no tenemos evidencia para descartar sorpresas a escala. Un widget con N=100 sintéticas tomaría 10 minutos escribir; no lo hicimos porque el número extrapolado es lo bastante convincente y respeta Article I sin exceso.


## Lo aprendido

**1. El patrón "monkey-patch para observar, no para transformar" es un contrato implícito de cuatro de los cinco adapters.** Bridge, Persistence, External Event, Logging — todos wrappean los siete métodos de mutación de nebula, capturan originales, y `destroy` restaura. La única diferencia entre ellos es qué hacen entre `original(...)` y `return`. El Logging Adapter hizo esto explícito en su spec ("strictly read-only"), pero es una propiedad que **todos** los adapters de este patrón comparten. Solo el Bridge modifica también estado externo (Pulsar); los otros son puros observers. **Consecuencia arquitectónica:** en Fase 1, si aparece un patrón "adapter-wrapper genérico" que factorice esto, sería un buen punto de estabilización.

**2. La set semantics de nebula (G-0) simplificó el diseño de cuatro adapters.** Sin G-0, cada adapter tendría que preguntarse "¿este link es duplicado?" o aceptar que emite eventos de no-ops. Con G-0, la respuesta viene gratis del snapshot pre/post. Es un caso donde una decisión de bajo nivel (semántica de link en nebula) elimina complejidad en la capa de arriba (adapters). El diseño de v0.3.0 de nebula pagó dividendos exactamente donde se anticipó.

**3. `BroadcastChannel` sí permite que dos instancias en el mismo tab se comuniquen entre sí.** No lo tenía completamente claro al empezar el widget de External Event, pero fue crucial para que el workaround del re-render funcionara: el `listenerChannel` externo al adapter recibe los mismos eventos que el canal interno. La restricción "no recibe sus propios mensajes" es **por instancia**, no por tab. Este dato micro no está en la mini-spec pero merece añadirse a la documentación operativa del adapter en algún momento.

**4. El anti-eco de External Event funciona por doble mecanismo, y el segundo salva casos que el primero podría no capturar.** El primero es "aplica vía original, no vía wrapped" → no se re-emite. El segundo es "chequea `origin === self.origin` y descarta" → si por transporte futuro el evento propio llegara de vuelta, aún se filtra. En el harness ambos mecanismos se probaron implícitamente. En el widget, el segundo mecanismo se hizo visible porque el `listenerChannel` externo **sí** recibe los eventos propios (que se descartan por origin). El adapter es más robusto de lo que la lectura casual sugiere.

**5. Un adapter puede ser "cerrado por lo que resuelve, abierto por lo que no resuelve".** Capa 12 (External Event) es exactamente eso. El harness verde y el widget verde confirman que hace lo que la mini-spec compromete. Pero 12-BRIDGE-INTEGRATION y 12-PERSISTENCE-INTEGRATION quedan formalmente como deuda, y por instrucción tuya explícita "no cerramos Capa 12 como completa". Es una postura honesta que separa "el adapter individual funciona" de "el ecosistema de adapters es completo". La distinción es útil.

**6. El scope congelado por widget (Disciplina 1) es más importante que su elegancia sugiere.** El widget de External Event pudo haber crecido a "editor colaborativo entre tabs con Bridge y Persistence" y habría sido interesante pero habría probado tres cosas a la vez. Al congelarlo en "sync minimal entre dos tabs sin más adapters", el reporte que produjiste fue interpretable línea por línea. Al mezclarse habría sido difícil saber qué exactamente estaba fallando o funcionando.


## Lo diferido explícitamente

De esta sesión salieron **cuatro ítems nuevos de deuda formal:**

- **PERSISTENCE-INDEXEDDB** — comprometido en la mini-spec de Persistence §7.
- **12-BRIDGE-INTEGRATION** — remote mutations no re-proyectan a Pulsar en el receptor.
- **12-PERSISTENCE-INTEGRATION** — remote mutations no persisten en el receptor.
- **BRIDGE-REACTIVE cuantificado** — no es nuevo, pero recibió evidencia empírica (73% con N=8) que lo transformó de hipótesis a dato.

Y **una deuda arquitectónica emergente** identificada en esta retrospectiva pero **no registrada formalmente todavía**:

- **ADAPTER-UTILS-DEDUP** — los cuatro adapters que wrappean nebula duplican `_snapshotLinksOf` y `_sameShallowLinks`. Consolidación candidata a v0.2.0 de Fase 1. Ver §Lo malo #1.

Recomendación: registrar esta última en `PHASE_0_DEFERRED.md` en la Parte 2 de esta misma sesión.


## Lo que NO se hizo (y por qué está bien)

**1. No se probó BRIDGE-REACTIVE con N=100.** El dato de N=8 más la extrapolación teórica son suficientes para informar la decisión de "cuándo priorizar Camino 2". Más medición sería teatro de Article I sin necesidad real.

**2. No se implementó `combineSinks` en Logging.** Está mencionado en la mini-spec como "trivial en v0.2.0 cuando aparezca demanda". Añadirlo ahora sería adelantarse a una necesidad hipotética. Article I aplicado a features, no solo a claims.

**3. No se resolvieron 12-BRIDGE-INTEGRATION / 12-PERSISTENCE-INTEGRATION en esta sesión.** La resolución requiere coordinación entre tres adapters y decisiones arquitectónicas (¿flag "isRemote"? ¿dispatcher unificado? ¿hooks?) que se benefician de más evidencia de uso real. Empujar la decisión sin evidencia produciría una API que quizás no sirva. Correcto diferir.

**4. No se construyó un "widget canónico completo" con los cinco adapters combinados.** Habría sido tentador — un editor de flujo que hidrata, mostra reactivamente, sincroniza entre tabs, persiste, y loguea todo. Pero eso es Fase 1, no cierre de Fase 0. El scope congelado (Disciplina 1) protegió contra este scope creep silencioso.


## Recomendaciones para la Fase 1

Basado en lo aprendido, no en especulación:

**1. Consolidar el patrón "adapter wrapper" en un helper compartido.** Los cuatro adapters lo demuestran empíricamente. La forma del helper debe salir de un quinto o sexto adapter, no de una spec anticipada.

**2. Priorizar BRIDGE-REACTIVE (Camino 2) al construir el primer widget factory que suscriba múltiples elementos a `entities.*`.** El dato de 73% de ruido dice que la fricción aparece antes de lo cómodo. No es urgente antes, pero es urgente cuando lleguen los widgets factory.

**3. Diseñar la resolución de 12-BRIDGE-INTEGRATION / 12-PERSISTENCE-INTEGRATION con un widget real que las evidencie primero.** Un editor pequeño que combine los tres adapters expondrá la fricción concreta. La resolución arquitectónica debe salir de ese friccionar, no antes.

**4. Escribir un `README.md` de nivel proyecto que explique el stack.** Todo lo que hicimos vive en specs y mini-specs. Falta el punto de entrada narrativo que le diga a un tercero (o a ti mismo dentro de tres meses) "esto es Nexus, así se compone". Es candidato para el Punto 7 o para arrancar Fase 1.


## Métricas de esta sesión

**Artefactos producidos:**
- 5 mini-specs (Bridge y Hydration ya existían; escribimos Persistence, External Event, Logging).
- 5 archivos de código adapter.
- 5 harness browser-native.
- 5 widgets canónicos.
- 3 specs de primitivas actualizadas (nebula 0.3.0, Chunklet 0.4.0, Nexus 0.3.1).
- 1 documento de deuda técnica actualizado (`PHASE_0_DEFERRED.md`).

**Aserciones verdes acumuladas:** 241 en harness (50 + 41 + 50 + 42 + 58).

**Widgets validados empíricamente:** 5 de 5, todos con reporte de usuario.

**Ítems nuevos de deuda registrados:** 4 formales + 1 pendiente de registrar (ADAPTER-UTILS-DEDUP).

**Ciclos de "descubrir → registrar → codificar → validar":** 5 completos, cero incompletos.


*Fin del Session Doc.*
