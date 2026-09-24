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
npm run dev       # http://localhost:5173
npm run build     # build de producción en dist/
npm run preview   # sirve el build de producción
```

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
src/
├── main.js                  # Arma el mundo del escenario y corre el loop principal
├── config.js                # Parámetros (física, IA), multas y definición de escenarios
├── state/                   # gameState.js (estado de la partida), settings.js (ajustes guardados), keybindings.js (teclas reasignables)
├── core/                    # renderer, escena, física (cannon-es) y ajustes de rendimiento
├── assets/                  # Vehículos, props y primitivas procedurales
├── world/
│   ├── streetKit.js         # Calles con bordillos abiertos en cruces, suelo, edificios
│   ├── road.js, gridCity.js, roundabout.js, tutorialCourse.js, parkingLot.js   # Un builder por layout
│   ├── crosswalks.js        # Registro de cebras (rayas, señales, hueco para frenar)
│   └── intersections.js, schoolZone.js, speedBumps.js, ...
├── entities/
│   ├── aiTraffic.js         # Tráfico de las avenidas (perfiles, rebases, esquivar autos malogrados)
│   ├── roundaboutAi.js      # Tráfico que sigue rutas y cede el paso en la rotonda
│   ├── drivers.js           # Perfiles de conductor: bueno / normal / imprudente
│   ├── breakdowns.js        # Eventos de auto malogrado + rebase cronometrado
│   ├── cabin.js             # Posición del ojo y de los espejos dentro del auto
│   ├── cockpit.js, instrumentCluster.js   # Tablero 3D y relojes (canvas)
│   ├── pedestrians.js, scriptedCars.js, player.js, ...
├── systems/                 # input, reglas, cámara/espejos, audio, tutorial y estacionamiento (guías por pasos)
└── ui/                      # menú, diálogos de configuración (global con pestañas), HUD, formularios de ajustes y de teclas
```
