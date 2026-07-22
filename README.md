# Mi Carrera · UNLaM — Planificador de Ingeniería en Informática

App web 100% cliente (sin backend) para **controlar tu avance** en Ingeniería en
Informática de la **UNLaM (plan 2023-2)** y, sobre todo, **planificar tus
cuatrimestres para recibirte en el menor tiempo posible**.

Todo tu estado se guarda en `localStorage` (nunca sale de tu navegador) y podés
exportarlo/importarlo como JSON o compartirlo por link.

## ✨ Qué hace

- **Tablero**: avance, horas, promedio (con y sin aplazos), materias en curso,
  cuatrimestres restantes, fecha estimada de egreso, cadena crítica y alertas.
- **Materias**: marcar aprobadas (con nota), regularizadas, en curso; filtros por
  año/trayecto/estado; **importar pegando** tu historia académica o intraconsulta.
- **Correlativas**: grafo interactivo (React Flow). Clic en una materia para ver
  qué necesita (aguas arriba) y qué desbloquea (aguas abajo).
- **Simulador**: cronograma **automático** que minimiza el makespan (cuatris hasta
  recibirte) por *list scheduling* de ruta crítica + compactación, y un modo
  **manual** con drag & drop y validación en vivo (correlativas, capacidad,
  choques de horario).
- **Comparador**: poné lado a lado estrategias (p.ej. 5 vs 6 materias por cuatri)
  y compará fecha de egreso, carga y riesgo.
- **Oferta**: cargá la oferta de comisiones para detectar choques de horario y que
  el simulador use días/horarios reales.

## 🧠 Cómo prioriza (el núcleo)

El objetivo es **recibirte cuanto antes**. Por eso el peso de cada materia se mide,
en primer lugar, por la **ruta crítica en cuatrimestres**: la longitud de la cadena
de correlativas que encabeza. Una materia que destraba una cadena larga se hace lo
antes posible, porque define el mínimo de cuatris posibles. Se desempata por
cantidad de materias que desbloquea, por escasez de oferta y por horas.

El simulador es un problema de *scheduling con precedencias y capacidad* (minimizar
makespan), NP-hard. Se resuelve con el heurístico estándar (greedy por ruta crítica)
más una pasada de mejora local. Ver `src/domain/{graph,priority,scheduler}.ts`,
con tests en Vitest.

## 🛠️ Desarrollo

Requiere Node 18+.

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests unitarios (Vitest)
npm run build    # build de producción a dist/
npm run preview  # previsualizar el build
```

## 🚀 Publicar en GitHub Pages

El repo incluye un workflow (`.github/workflows/deploy.yml`) que buildea con Vite y
publica `dist/` en Pages automáticamente en cada push a `main`.

### Pasos

1. Creá un repositorio en GitHub y subí este proyecto:
   ```bash
   git init
   git add .
   git commit -m "Mi Carrera UNLaM"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Listo. En cada push a `main` se despliega solo. La URL será:
   - **Repo normal** (`TU-REPO`): `https://TU-USUARIO.github.io/TU-REPO/`
   - **Repo de usuario** (`TU-USUARIO.github.io`): `https://TU-USUARIO.github.io/`

El `base` de Vite se calcula automáticamente en el workflow según el nombre del
repo (incluye el caso `usuario.github.io` → `base=/`). Si corrés el build a mano
para un subdirectorio, pasá `BASE_PATH`:

```bash
BASE_PATH=/mi-repo/ npm run build
```

## 📥 Cargar tus datos

Cada usuario carga **sus propios datos**, que quedan en el `localStorage` de su
navegador. No se guarda nada personal en el repositorio.

- **Materias → Importar pegando texto**: pegá las filas de tu historia académica /
  intraconsulta. Se matchea por código o nombre e **ignora los códigos del plan
  viejo** (equivalencias) automáticamente.
- **Datos → Importar JSON**: restaurá un backup que hayas exportado.
- **Datos → Exportar a JSON**: guardá un backup de tu estado.
- **Datos → Cargar datos de ejemplo**: prueba rápida con datos ficticios.

> La historia académica del campus **no incluye materias regularizadas**; cargalas
> a mano (botón *Regular*) para que cuenten como correlativa cumplida para cursar.

## 🗂️ Estructura

```
src/
  data/           # plan de estudios + estados JSON
  domain/         # grafo, prioridad, scheduler, choques, alertas (+ tests)
  store/          # Zustand + persistencia en localStorage
  lib/            # hooks y helpers (derivación, formato, persistencia)
  components/     # UI reutilizable
  pages/          # Tablero, Materias, Grafo, Simulador, Comparador, Oferta
```

## 📄 Licencia y datos

El plan de estudios es público (Secretaría Académica UNLaM). Tus datos académicos
son tuyos y viven solo en tu navegador salvo que los exportes o compartas.
