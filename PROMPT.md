# Prompt para Claude Code — App "Planificador de Carrera UNLaM"

Copiá TODO este archivo como primer mensaje en Claude Code, dentro de la carpeta vacía del proyecto. En esa carpeta ya dejé tres archivos (`plan-estudios.json`, `mi-estado-ejemplo.json`, `oferta-ejemplo.json`); usalos.

---

## 1. Objetivo

Construir una single-page app web, desplegable en **GitHub Pages**, que le sirva a cualquier estudiante de **Ingeniería en Informática de la UNLaM (plan 2023-2)** para controlar su avance en la carrera y —lo más importante— **planificar sus cuatrimestres minimizando el tiempo máximo hasta recibirse**. La app es 100% cliente (sin backend). Cada usuario carga sus propios datos, que se guardan en `localStorage` y se pueden exportar/importar como JSON.

El plan de estudios (materias, correlativas, horas, año, trayecto) viene precargado desde `plan-estudios.json` y es común a todos. Lo que es propio de cada usuario: materias aprobadas con nota, materias en curso, y los cuatrimestres que va armando.

## 2. Stack y despliegue

- **React + Vite + TypeScript**. Estado global con Zustand (simple) o Context; elegí Zustand.
- Estilado con **Tailwind CSS**. Diseño limpio, oscuro por defecto con toggle claro, tipografía legible, mobile-first.
- **Persistencia**: `localStorage` con un store versionado (clave `unlam-planner-v1`). Nunca uses cookies ni backend.
- **Grafo de correlativas**: usá **React Flow** (recomendado) o D3. Debe ser interactivo (zoom, pan, click en nodo).
- **Deploy a GitHub Pages** vía GitHub Actions (workflow que buildea con Vite y publica `dist/`). Configurá `base` en `vite.config.ts` con el nombre del repo. Dejá un `README.md` con los pasos exactos para publicarlo en `usuario.github.io/repo` y también instrucciones si el usuario usa un repo `usuario.github.io` (base `/`).
- Todo el texto de UI en **español rioplatense**.

## 3. Modelo de datos

Cargá `plan-estudios.json`. Cada materia:
```ts
type Subject = {
  code: string; name: string; year: number;
  prereqs: string[];        // códigos correlativos
  weeklyHours: number; totalHours: number;
  track: string;            // trayecto
  annual: boolean;          // ocupa los dos cuatrimestres del año
  startsOnlyFirstSemester: boolean; // p.ej. Proyecto Final: solo arranca en 1er cuatri
  isElective: boolean;
}
```
Estado del usuario:
```ts
type UserState = {
  approved: { code: string; grade: number }[]; // nota 1..10
  inProgress: string[];                          // cursando ahora
  plannedSemesters: PlannedSemester[];           // lo que arma el simulador o a mano
  settings: { maxNightSlots: number; /* default 5 */ startYear: number; startTerm: 1|2; };
}
```
Regla de aprobación: una materia es **elegible** para cursar si todas sus `prereqs` están en `approved`. Para el simulador, también cuentan como "ya hechas" las de cuatrimestres previos del propio plan.

Las 3 electivas (`03672/73/74`) son placeholders: cualquier oferta de electiva las satisface. Tratalas como materias sin correlativas que ocupan un slot; permití al usuario renombrarlas con la electiva real que cursó.

## 4. Funcionalidades (todas)

### 4.1 Tablero de estado
- Progreso: materias aprobadas / total, % de avance, horas acumuladas / totales.
- **Promedio** (con y sin aplazos, mostrá ambos): promedio simple de notas de aprobadas. Mostrá también un promedio proyectado editable.
- Materias **en curso** este cuatrimestre, destacadas.
- Contador de materias que faltan y estimación de cuatrimestres restantes (ver 4.4).

### 4.2 Grafo de correlativas interactivo
- Nodos = materias, aristas = correlatividad (dirigida: correlativa → materia que la requiere).
- Colores por estado: aprobada / en curso / elegible ahora / bloqueada. Y opción de colorear por trayecto.
- Al clickear una materia: resaltá toda su **cadena aguas arriba** (lo que necesita) y **aguas abajo** (lo que desbloquea).
- Mostrá visualmente la **ruta crítica** hacia el Proyecto Final (ver 4.4).

### 4.3 Editor de materias
- Marcar aprobada + nota, marcar en curso, desmarcar.
- Buscador y filtros por año, trayecto, estado.
- Importar aprobadas pegando texto tabular (como el que exporta la intraconsulta UNLaM: columnas Código/Nombre/Condición/Nota). Parseá y matcheá por código o por nombre normalizado.

### 4.4 Motor de prioridad y simulador de cuatrimestres  ← EL NÚCLEO

Esta es la parte más importante. Implementala con cuidado y documentala en el código.

**a) Peso / prioridad de cada materia.** Para cada materia pendiente, calculá:
- `criticalPath(m)` = camino más largo (en horas totales, sumando `totalHours` de los nodos) desde `m` hasta cualquier materia terminal siguiendo las aristas de correlatividad hacia abajo. Es decir, cuán larga es la cadena que esta materia encabeza. **Este es el factor dominante**: una materia que destraba una cadena larga debe hacerse lo antes posible, porque define el mínimo de cuatrimestres posibles.
- `descendants(m)` = cantidad de materias que dependen (transitivamente) de `m`. Mide "poder de desbloqueo".
- `scarcity(m)` = qué tan poco se ofrece (si hay datos de oferta; ver 4.5). Materia que se da un solo cuatri al año o con una sola comisión pesa más.
- `depth(m)` = longitud de la cadena de correlativas por encima (para ordenar dentro de un cuatri).

`priority(m)` = orden lexicográfico: primero `criticalPath` (desc), luego `descendants` (desc), luego `scarcity` (desc). Mostrá el score y un desglose (“esta materia pesa porque encabeza una cadena de N cuatrimestres y desbloquea M materias”).

**b) Simulador que minimiza el makespan (cuatrimestres hasta recibirse).**
Es un problema de *scheduling con precedencias y capacidad* (minimizar makespan). Es NP-hard en general, así que usá **list scheduling greedy por ruta crítica**, que es el heurístico estándar y da resultados muy buenos, y después una pasada de mejora local. Algoritmo:

1. Pendientes = todas las no aprobadas y no en curso (las en curso contás como aprobadas al cierre del cuatri actual, salvo que el usuario indique lo contrario).
2. Repetí, cuatri por cuatri, hasta vaciar pendientes:
   - `elegibles` = pendientes cuyas correlativas ya están aprobadas o programadas en cuatris anteriores.
   - Aplicá restricciones de calendario: `startsOnlyFirstSemester` (Proyecto Final solo entra si el cuatri es 1°); materias `annual` ocupan slot en este y el cuatri siguiente.
   - Ordená `elegibles` por `priority`.
   - Empaquetá hasta `maxNightSlots` materias en el cuatri **respetando choques de día/horario** cuando haya datos de oferta (una materia por franja/día). Materias en turno mañana/tarde o modalidad a distancia/virtual **no consumen** slot nocturno: contámoslas aparte (permití configurar cuántos slots no-nocturnos tolera el usuario, default 1).
   - Regla especial ya conocida: hay materias que sólo conviene ubicar temprano porque encabezan la cadena del Proyecto Final. El criterio de ruta crítica ya las prioriza solo; no hardcodees, que emerja del cálculo.
3. `makespan` = cantidad de cuatris usados. Calculá la **fecha estimada de egreso** a partir de `startYear`/`startTerm` (1er cuatri ≈ marzo–julio, 2do ≈ agosto–diciembre) y sumá medio año de trámite de título como estimación editable.
4. **Mejora local**: intentá mover materias entre cuatris adyacentes para reducir makespan o balancear carga (menos materias pesadas juntas). Si no mejora, dejá el greedy.
5. Marcá y mostrá la **cadena crítica**: la secuencia de materias que determina el makespan (si una se atrasa, se atrasa el egreso). El usuario tiene que ver clarísimo cuáles son “intocables”.

**c) Simulador manual.** Además del automático, dejá que el usuario arrastre materias a cuatrimestres a mano (drag & drop). Validá en vivo: correlativas no cumplidas (bloqueá), choques de horario (alertá), exceso de slots (alertá). Mostrá para cada armado manual el makespan resultante y la fecha de egreso, para comparar contra el óptimo automático.

**d) Comparador de escenarios.** Permití guardar varios planes (ej. “6 por cuatri” vs “5 por cuatri”) y compararlos lado a lado: fecha de egreso, carga promedio, materias pesadas por cuatri, riesgo (cuántas materias de ruta crítica hay sin margen).

### 4.5 Oferta de comisiones (opcional pero copado)
- Importar la oferta de un cuatri (formato en `oferta-ejemplo.json`, o pegando la tabla de intraconsulta). Con eso, el simulador conoce días/horarios reales y detecta choques.
- **Detección de choques**: matriz visual día × franja mostrando solapamientos entre las materias elegidas.
- Si una materia elegible no está en la oferta del cuatri, marcala como “no ofertada este cuatri” y penalizá (no la pongas ahí).

### 4.6 Alertas inteligentes
- “Ojo: `X` está en la ruta crítica y solo se ofrece los miércoles noche; si se cae esa comisión se te atrasa el egreso.”
- “Estás dejando las 3 electivas para el último cuatri; sembralas antes para no saturar.”
- “`Taller de Integración` figura habilitado pero no lo cargaste; verificá si te corresponde.”
- Materias sin correlativas hacia abajo (hojas) → sugerí dejarlas para el final.

### 4.7 Extras que suman
- Export/import de todo el estado a JSON (y botón “cargar datos de ejemplo” que use `mi-estado-ejemplo.json`).
- Compartir un plan por URL (serializá el estado en el hash, comprimido con lz-string) — así el usuario manda su plan a un compañero sin backend.
- Modo imprimible / export a PDF del plan de cuatrimestres (usá `window.print()` con estilos print).
- Toggle tema claro/oscuro.
- Todo accesible (roles ARIA, navegación por teclado en el grafo y el drag & drop).

## 5. Arquitectura sugerida
```
src/
  data/plan-estudios.json
  domain/
    graph.ts         // construcción DAG, criticalPath, descendants, depth
    scheduler.ts     // simulador greedy + mejora local + makespan
    priority.ts      // scoring de materias
    conflicts.ts     // choques de horario
  store/useStore.ts  // Zustand + persist localStorage
  components/...
  pages/...
```
Escribí **tests unitarios** (Vitest) para `graph.ts`, `priority.ts` y `scheduler.ts`: casos con correlativas encadenadas, materia anual, y verificación de que el makespan calculado respeta precedencias y capacidad.

## 6. Cómo trabajar
Andá por partes y mostrame cada bloque antes de seguir: (1) scaffolding Vite+TS+Tailwind y carga del plan; (2) store + tablero de estado + promedio; (3) grafo de correlativas; (4) motor de prioridad + simulador con tests; (5) simulador manual drag&drop + comparador; (6) oferta y choques; (7) deploy a Pages. Explicá decisiones en el camino y dejá el código comentado en español.

**Empezá por el paso (1) y frená para que revise.**
