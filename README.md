# Simulador de Manejo - Tránsito Limeño

Simulador de manejo 3D ambientado en el tránsito urbano de Lima, Perú. Construido con
[Three.js](https://threejs.org/) (render) y [cannon-es](https://pmndrs.github.io/cannon-es/)
(física), con todos los modelos generados proceduralmente a partir de primitivas (sin
assets `.gltf`/`.obj`). Cabina en primera persona con espejos, tráfico con conductores
buenos, normales e imprudentes (combis y mototaxis incluidos), peatones en cebras y un motor
de reglas basado en el Reglamento Nacional de Tránsito (D.S. N° 016-2009-MTC).

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior
- npm (incluido con Node.js)

## Instalación y ejecución

```bash
npm install
npm run dev         # http://localhost:5173
npm run typecheck   # TypeScript en modo estricto (src/ y vite.config.ts)
npm run build       # typecheck + build de producción en dist/
npm run preview     # sirve el build de producción
```

El proyecto está escrito en **TypeScript** (modo `strict`) y **SCSS** sobre Vite.

## Escenarios

Al pulsar **JUGAR** se elige un escenario; al seleccionarlo aparecen **CONFIGURAR** y **JUGAR**.

| Escenario | Qué practicas |
|---|---|
| **Tutorial guiado** | Recorrido fijo paso a paso (sin azar): acelerador, volante, freno, direccionales, bocina, cambio de carril con auto que te rebasa, rompemuelas, cebra con peatón, auto malogrado, semáforo, giro a la derecha, PARE, giro a la izquierda y rotonda. Un panel indica qué hacer en cada momento |
| **Recta Directa** | Avenida de 2 carriles por sentido: velocidad, señalización, distancias |
| **Autopista Densa** | 3 carriles por sentido, tráfico denso e imprudente |
| **Ciudad con Giros** | Cuadrícula con semáforos, giros y cebras |
| **Rotondas** | Rotonda de cuatro accesos: ceder el paso, elegir salida y señalizarla |
| **Estacionamiento en paralelo** | Entrar en reversa a un hueco entre dos autos junto a la vereda: alinearse con el auto de adelante, 45° con el volante a la derecha, enderezar y acomodar con el volante a la izquierda |
| **Estacionamiento en batería** | Entrar en reversa a una plaza de un estacionamiento con pasillo, entre dos autos, usando las líneas de la plaza y los dos espejos |

## Controles

Estas son las teclas por defecto; todas se pueden cambiar en **Configuración → Teclas**.

| Control | Acción |
|---|---|
| Mouse (arrastrar) | Girar el volante (se auto-centra al soltar) |
| `A` / `D` o `←` / `→` | Girar el volante con teclado |
| Rueda del mouse ↑ / ↓ | Subir / bajar el acelerador (se mantiene en su posición) |
| `S` / `↓` | Freno (casi detenido, mantenerlo mete la reversa, que avanza a paso de tortuga) |
| `Espacio` | Freno de mano |
| `Q` / `E` | Direccional izquierda / derecha (flechas verdes en el tablero) |
| `L` | Apagar direccionales |
| `H` | Bocina |
| `R` / `Esc` | Reiniciar / volver al menú |
| `Ctrl+L` | Registro de depuración (fija) |

## Configuración

- **Por escenario** (botón *CONFIGURAR*): duración, límite de velocidad, cantidad de tráfico,
  % de conductores imprudentes y educados, autos que te rebasan, autos malogrados en tu
  carril, peatones, cebras, y tamaño del espacio y guía de referencias (estacionamiento).
- **Global** (engranaje arriba a la derecha, solo en los menús), en tres pestañas:
  - **Movimiento**: paso y tiempos del acelerador, soltado automático, inversión de la rueda,
    rampas y fuerza del freno, freno motor, freno de mano, giro del volante, respuesta y
    autocentrado, giro con teclado, fuerza del motor y velocidad máxima.
  - **Teclas**: cada acción tiene una tecla principal y una alternativa. Haz clic en una y
    pulsa la nueva (`Esc` cancela, `Retroceso` la borra). Si la tecla ya se usaba en otra
    acción, se la quita a esa. Los textos del tutorial, la ayuda y los avisos muestran tus teclas.
  - **Rendimiento**: resolución de render, distancia de visión, sombras y su calidad, espejos
    laterales, calidad y frecuencia de actualización de los espejos, y **mostrar FPS**.
    Se aplican al empezar la siguiente partida.

Cada pestaña tiene su propio botón *Restaurar pestaña*. Todo se guarda en `localStorage`.

## Reglas de tránsito implementadas

Las multas (en soles) se acumulan y se detallan al terminar la partida.

| Código | Infracción | Multa |
|---|---|---|
| M20 | Exceso de velocidad (más de 6 km/h sobre el límite; 30 km/h en zona escolar) | S/ 20 |
| G10 | Cambio de carril sin señalizar | S/ 10 |
| G28 | Cruzar con luz roja | S/ 15 |
| G57 | No ceder el paso a un peatón en una cebra | S/ 10 |
| M12 | Conducir en sentido contrario (incluye circular al revés en una rotonda) | S/ 20 |
| — | Choque | S/ 25 |
| — | Rompemuelas a más de 20 km/h | S/ 5 |
| — | Rotonda: no ceder el paso / salir sin señalizar | S/ 20 / S/ 10 |
| — | Giro sin señalizar / no respetar el PARE (tutorial) | S/ 10 / S/ 20 |
| — | Choque contra la vereda (a más de 8 km/h): el auto queda inmovilizado hasta reiniciar | S/ 25 |
| — | Estacionamiento: tocar un auto / rozar la vereda / maniobrar sin señalizar | S/ 25 / S/ 10 / S/ 10 |

## Cabina y espejos

- Vista desde el asiento del conductor (volante a la izquierda del auto): el volante y el tablero
  quedan justo enfrente. El tablero tiene tacómetro, velocímetro, pantalla central (velocidad
  digital, direccionales, marcha P R N D, odómetro y testigos), ventilas, pantalla táctil y consola.
- Los espejos laterales están en las puertas y el retrovisor arriba, en el centro del parabrisas,
  en el lugar donde estarían en un auto real. Muestran la imagen invertida como un espejo de
  verdad, con un borde del propio auto a la vista como referencia.

## Estacionamiento

Dos escenarios sin tráfico ni límite de tiempo. Un panel guía muestra los pasos con sus puntos de
referencia (parachoques, espejos, ángulo de 45°, líneas de la plaza) y medidas en vivo; se puede
apagar desde **CONFIGURAR** junto con el tamaño del espacio (amplio / normal / justo). Terminas
al quedar dentro de las líneas, paralelo y detenido unos 2 segundos. La reversa se activa
manteniendo el freno (`S` por defecto) con el auto casi detenido y avanza a paso de tortuga (máx. 6 km/h).

## Estructura del proyecto

```
index.html                   # Solo la pantalla de inicio (lo primero que se ve); el resto se crea bajo demanda
vite.config.ts               # Plugin de CSS crítico + partición de chunks (three / cannon-es aparte)
src/
├── main.ts                  # Punto de entrada mínimo: router, pantalla de inicio y engranaje
├── app/                     # router.ts (pantallas), screens.ts (imports dinámicos), prefetch.ts, autostart.ts
├── screens/                 # home.ts, scenarios.ts (selector), game.ts (HUD + arranque de la partida)
├── dialogs/                 # dialog.ts + controles, registro, configuración global y por escenario (cada uno carga a demanda)
├── game/
│   ├── session.ts           # Lo común a toda partida: render, física, jugador, loop
│   ├── layouts/             # line, grid, roundabout, tutorial, parking: lo propio de cada escenario (un chunk cada uno)
│   ├── hudTemplate.ts, hud.ts, results.ts
├── config.ts                # Parámetros (física, IA), multas y definición de escenarios
├── state/                   # gameState.ts, settings.ts (ajustes guardados), keybindings.ts (teclas reasignables)
├── core/                    # renderer, escena, física (cannon-es), batching y ajustes de rendimiento
├── assets/                  # Vehículos, props y primitivas procedurales
├── world/                   # Un builder por layout (road, gridCity, roundabout, tutorialCourse, parkingLot) + streetKit, crosswalks, ...
├── entities/                # Tráfico, peatones, jugador, cabina y tablero 3D
├── systems/                 # input, reglas, cámara/espejos, audio, tutorial y estacionamiento (guías por pasos)
├── ui/                      # Formularios de ajustes y de teclas, iconos de escenarios, panel del tutorial
├── styles/                  # SCSS: abstracts/ (variables, mixins), critical.scss, y una hoja por pantalla/componente
├── types/                   # Ampliaciones de tipos (cannon-es)
└── utils/
```

## Carga y renderizado

- **Solo se renderiza el HTML que la pantalla actual necesita.** `index.html` trae únicamente la pantalla
  de inicio. El selector de escenarios, el HUD, los diálogos y los resultados los crea su propio módulo
  cuando hacen falta y los retira del documento al salir. Dentro del HUD tampoco se dibuja lo que el
  escenario no usa: sin cuenta regresiva en los ejercicios sin tiempo, sin contador de FPS ni espejos
  laterales si están desactivados, sin el panel de instrucciones fuera del tutorial y el estacionamiento
  guiado.
- **CSS crítico.** `src/styles/critical.scss` (reset, pantalla de inicio y engranaje) no lo importa ningún
  script: el plugin de `vite.config.ts` lo compila y lo incrusta en un `<style>` de `index.html`, así que
  la primera pantalla se pinta sin pedir hojas de estilo. Las demás hojas las importa el módulo que las
  usa y viajan con su chunk.
- **Carga diferida.** El selector, cada diálogo, la pantalla de juego y los resultados son chunks aparte.
  El juego 3D (three.js, cannon-es y el código común) se descarga al elegir un escenario, mientras se
  muestra el selector, y solo entonces se carga el layout de ese escenario (`game/layouts/*`).
  Reiniciar o volver al inicio recarga la página (ver `app/autostart.ts`).
