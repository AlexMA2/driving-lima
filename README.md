# Simulador de Manejo - Tránsito Limeño

Simulador de manejo 3D ambientado en el tránsito urbano de Lima, Perú. Construido con
[Three.js](https://threejs.org/) (render) y [cannon-es](https://pmndrs.github.io/cannon-es/)
(física), con todos los modelos generados proceduralmente a partir de primitivas (sin
assets `.gltf`/`.obj`). Incluye una IA de tráfico (combis y mototaxis que cambian de carril
sin señalizar, autos que se malogran en plena vía), peatones que cruzan indebidamente, y un
motor de reglas basado en el Reglamento Nacional de Tránsito peruano (D.S. N° 016-2009-MTC).

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior
- npm (incluido con Node.js)

## Instalación y ejecución

```bash
npm install
npm run dev
```

Esto abre el simulador en `http://localhost:5173`. Vite recarga en caliente al editar
cualquier archivo en `src/`.

Otros comandos disponibles:

```bash
npm run build     # genera el build de producción en dist/
npm run preview   # sirve el build de producción localmente para probarlo
```

## Controles

| Tecla | Acción |
|---|---|
| `W` / `↑` | Acelerar |
| `S` / `↓` | Frenar / Reversa |
| `A` / `D` o `←` / `→` | Girar |
| `Espacio` | Freno de mano |
| `Q` / `E` | Direccional izquierda / derecha |
| `C` | Cambiar cámara (persecución en 3ra persona / capó) |
| `L` | Apagar direccionales |

## Reglas de tránsito implementadas

| Código | Infracción | Condición | Penalidad |
|---|---|---|---|
| M20 | Exceso de velocidad | >50 km/h en zona urbana, >30 km/h en zona escolar | -20 pts |
| G10 | Cambio de carril sin señalización | Cambiar de carril sin activar el direccional | -10 pts |
| G28 | Cruce en luz roja | Cruzar una intersección con el semáforo en rojo | -15 pts |
| G57 | No ceder el paso | No ceder el paso a un peatón cruzando | -10 pts |
| — | Choque | Impacto con otro vehículo, obstáculo o peatón | -25 pts, +30% daño |
| — | Rompemuelas a alta velocidad | Pasar un rompemuelas a >20 km/h | -5 pts, +10% daño |

El puntaje del conductor empieza en 100. Al llegar a 0 se muestra la pantalla de
"Licencia Suspendida" y la simulación se detiene.

## Estructura del proyecto

```
src/
├── main.js                 # Punto de entrada: arma el mundo y corre el loop principal
├── style.css                # Estilos del HUD y las pantallas de inicio/game over
├── config.js                 # Parámetros ajustables (física, IA, límites de velocidad)
├── state/
│   └── gameState.js          # Estado mutable compartido (puntaje, daño, game over)
├── utils/
│   └── rng.js                 # PRNG determinístico (mundo estable entre recargas)
├── core/
│   ├── renderer.js            # WebGLRenderer, cámara principal y de espejo
│   ├── scene.js                # Escena, niebla, iluminación
│   └── physics.js              # Mundo cannon-es y materiales de contacto
├── assets/
│   ├── primitives.js            # Helpers box()/cyl()
│   ├── vehicles.js               # Sedán, mototaxi, combi (bajo poligonaje, procedural)
│   └── props.js                   # Conos, rompemuelas, semáforos, señales, peatones
├── world/
│   ├── road.js                     # Pista, veredas, líneas de carril
│   ├── buildings.js                 # Fachadas urbanas (InstancedMesh)
│   ├── intersections.js              # Semáforos y cruces peatonales
│   ├── schoolZone.js                  # Zona escolar (límite de 30 km/h)
│   ├── speedBumps.js                   # Rompemuelas no señalizados
│   └── decorations.js                   # Señalética decorativa (PARE, etc.)
├── entities/
│   ├── player.js                        # Vehículo del jugador (RaycastVehicle)
│   ├── breakdowns.js                     # Escenarios de "carro malogrado"
│   ├── aiTraffic.js                       # Máquina de estados del tráfico IA
│   └── pedestrians.js                      # Peatones que cruzan indebidamente
├── systems/
│   ├── input.js                             # Teclado y control del vehículo
│   ├── rules.js                              # Motor de reglas / infracciones
│   └── cameraRig.js                           # Cámara de persecución/capó + espejo
└── ui/
    └── hud.js                                  # Velocímetro, puntaje, toasts, HUD
```

## Ajustar el comportamiento

- **Física del vehículo** (aceleración, frenado, dirección): `src/config.js`
- **Frecuencia de eventos de IA** (cambios de carril, paradas súbitas, peatones):
  `src/config.js`
- **Ubicación de semáforos, rompemuelas, zona escolar y autos malogrados**: los arrays al
  inicio de cada archivo en `src/world/` y `src/entities/breakdowns.js`
