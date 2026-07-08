# 🗺️ Optimización de Rutas Cafetaleras - Amazonas, Perú

Este proyecto es una aplicación Web GIS (Sistemas de Información Geográfica en la Web) orientada a optimizar la logística de recolección y distribución de café en diversas provincias del departamento de Amazonas, Perú.

La aplicación integra la lectura de coordenadas desde archivos KML, el trazado de rutas viales reales mediante el proyecto OSRM y una intensa comparativa computacional utilizando múltiples algoritmos clásicos y modernos (propios y de terceros) para resolver el **Problema del Viajante de Comercio (TSP)**.

## 🚀 Tecnologías y Arquitectura

El proyecto sigue una arquitectura **Cliente-Servidor (Frontend / Backend)**:

- **Backend (Python 3)**:
  - **Flask**: Framework web principal para manejar las rutas (endpoints) y la API REST.
  - **Google OR-Tools**: Librería industrial para resolución matemática de optimización avanzada.
  - **Requests / PyKML**: Para consultas HTTP a OSRM y lectura estructural de archivos geográficos KML.
- **Frontend (Web/JS)**:
  - **Vanilla JavaScript, HTML5 y CSS3**: Para la estructuración y lógica interactiva de la interfaz.
  - **Leaflet.js**: Librería de mapas interactivos conectada a OpenStreetMap.
- **APIs Externas**:
  - **OSRM (Open Source Routing Machine)**: Provee distancias métricas reales de las carreteras y el vector de trazado poligonal en formato GeoJSON.

---

## 🧠 Algoritmos Implementados

Este proyecto es un laboratorio en vivo del comportamiento asintótico y de diseño de algoritmos. Contiene diversos paradigmas programados desde cero y métodos de búsqueda avanzados:

### 1. Algoritmos de Optimización de Rutas (Resolución del TSP)
Toda esta lógica matemática se ejecuta en el **Backend**.
- **📍 Algoritmo Voraz (Greedy)** `[core_logistica.py]`:
  - **Cómo funciona**: Empieza en el nodo origen y siempre viaja al nodo no visitado más cercano.
  - **Rendimiento**: Muy rápido, pero casi nunca encuentra la ruta óptima global.
- **📍 Fuerza Bruta** `[core_logistica.py]`:
  - **Cómo funciona**: Genera absolutamente todas las permutaciones posibles de las rutas y se queda con la más corta. 
  - **Rendimiento**: Lento y factorial $O(n!)$. Por seguridad computacional, el servidor lo bloquea si se seleccionan más de 10 fincas.
- **📍 Programación Dinámica (Held-Karp)** `[core_logistica.py]`:
  - **Cómo funciona**: Explora las combinaciones mediante *Memoización* (almacenando en caché los subproblemas ya resueltos) y operadores de bits (*Bitmask*).
  - **Rendimiento**: Encuentra la ruta perfecta garantizada y es más rápido que la Fuerza Bruta, con una complejidad de $O(n^2 \cdot 2^n)$.
- **📍 Backtracking con Poda (Pruning)** `[core_logistica.py]`:
  - **Cómo funciona**: Búsqueda exhaustiva mediante recursividad. Incluye una condición de "Poda": si al transitar una ruta parcial se supera el récord de la mejor distancia global, la rama actual se corta y se descarta inmediatamente.
  - **Rendimiento**: Más rápido que la Fuerza Bruta pura, pero sigue siendo exponencial. Limitado a 12 fincas.
- **📍 Google OR-Tools (Metaheurísticas)** `[app.py]`:
  - **Cómo funciona**: Emplea una combinación híbrida: genera una primera solución rápida con un algoritmo Voraz (FirstSolutionStrategy) y luego optimiza los cruces usando un motor de *Búsqueda Local Guiada* (Guided Local Search).

### 2. Algoritmos de Ordenamiento (Divide y Vencerás)
- **🔀 Merge Sort (Backend)** `[app.py]`:
  - **Uso**: Ordena el tablero final (la tabla comparativa de resultados JSON) basándose en la distancia métrica total (`distancia_km`). 
  - **Comportamiento**: Divide recursivamente la lista de resultados y la mezcla de forma ascendente, asegurando que el "algoritmo ganador" siempre aparezca de primero en la tabla ($O(n \log n)$).
- **🔀 Merge Sort (Frontend)** `[static/js/main.js]`:
  - **Uso**: Ordena la lista de Fincas cargadas en memoria alfabéticamente por su atributo de "nombre". Es el paso previo y obligatorio para que la Búsqueda Binaria funcione.

### 3. Algoritmos de Búsqueda
- **🔍 Búsqueda Binaria (Frontend)** `[static/js/main.js]`:
  - **Uso**: Permite buscar y centrar rápidamente una finca específica en el mapa utilizando la barra lateral.
  - **Cómo funciona**: Busca sobre el array previamente ordenado por el Merge Sort partiendo la lista en mitades iterativamente. Es extremadamente veloz y permite a Leaflet hacer un *FlyTo* instantáneo a la coordenada buscada.

---

## ⚙️ Estructura del Proyecto y Flujo de Trabajo

1. **`templates/index.html`**: Renderiza el visor web, la barra lateral, el seleccionador de provincias y la barra de Búsqueda Binaria.
2. **`static/js/main.js`**:
    - Detecta la selección del usuario y carga dinámicamente el KML.
    - Envía los puntos activos al endpoint `/api/calcular`.
    - Dibuja el *GeoJSON* de la carretera proveniente de OSRM en rojo y renderiza las tarjetas *Popup* e índices visuales.
3. **`app.py`**:
    - Expone los Endpoints REST.
    - Coordina la llamada a OSRM para armar una matriz de distancias viales reales.
    - Dispara todos los algoritmos simultáneamente, toma el tiempo de ejecución y usa *Merge Sort* para devolver una respuesta consolidada.
4. **`core_logistica.py`**:
    - Capa aislada para el modelo de negocio matemático: lectura XML/KML pura y la programación nativa de algoritmos (Voraz, Fuerza Bruta, PD, Backtracking).
5. **`static/kml/`**: Repositorio de los archivos de origen de datos espaciales pre-mapeados (Chachapoyas, Bagua, Luya, etc).

## 🚀 Despliegue Local

Para correr el proyecto en tu entorno local:

1. Crea o activa tu entorno virtual (opcional pero recomendado).
2. Instala las dependencias:
   ```bash
   pip install -r requirements.txt
   ```
3. Ejecuta la aplicación:
   ```bash
   python app.py
   ```
4. Ingresa desde tu navegador web a:
   `http://localhost:5000`
