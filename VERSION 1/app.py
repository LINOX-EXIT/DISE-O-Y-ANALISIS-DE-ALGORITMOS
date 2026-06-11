import os
import time
import requests
from flask import Flask, render_template, request, jsonify

# Importamos las funciones que guardaste en core_logistica.py
from core_logistica import (
    extraer_datos_kml,
    obtener_matriz_osrm_metros,
    algoritmo_voraz,
    algoritmo_fuerza_bruta,
    algoritmo_dinamico
)

# Importaciones para Google OR-Tools
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

app = Flask(__name__)

def obtener_geometria_ruta_real(puntos_ordenados):
    """
    Consulta al servicio de rutas de OSRM para obtener todas las micro-coordenadas 
    viales reales entre los puntos ya ordenados por el algoritmo.
    """
    if len(puntos_ordenados) < 2:
        return []
        
    # Formateamos las coordenadas en el formato que pide OSRM: lng,lat;lng,lat...
    coords_str = ";".join([f"{p['lng']},{p['lat']}" for p in puntos_ordenados])
    
    # Usamos el endpoint 'route' con geometries=geojson para obtener el trazado de la carretera
    url = f"http://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson"
    
    try:
        response = requests.get(url).json()
        if response.get('code') == 'Ok':
            # OSRM devuelve las coordenadas en formato [lng, lat] dentro del GeoJSON
            coords_geojson = response['routes'][0]['geometry']['coordinates']
            # Leaflet lee las coordenadas como [lat, lng], así que las invertimos
            ruta_vial_real = [[lat, lng] for lng, lat in coords_geojson]
            return ruta_vial_real
        return []
    except Exception as e:
        print(f"Error al obtener geometría de carretera desde OSRM: {e}")
        return []

# --- FUNCIÓN INTERNA PARA GOOGLE OR-TOOLS ---
def resolver_google_ortools(matriz_metros, punto_inicio):
    """Resuelve el TSP usando el motor industrial de Google OR-Tools (Voraz + Búsqueda Local)."""
    # Convertimos la matriz a enteros (OR-Tools no acepta flotantes)
    matriz_int = [[int(val) for val in fila] for fila in matriz_metros]
    
    manager = pywrapcp.RoutingIndexManager(len(matriz_int), 1, punto_inicio)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        return matriz_int[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    # Etapa 1: Solución Inicial Rápida (Voraz)
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    # Etapa 2: Optimización mediante Metaheurística (Búsqueda Local Guiada)
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.seconds = 2

    solution = routing.SolveWithParameters(search_parameters)
    
    if solution:
        ruta = []
        index = routing.Start(0)
        while not routing.IsEnd(index):
            ruta.append(manager.IndexToNode(index))
            index = solution.Value(routing.NextVar(index))
        ruta.append(manager.IndexToNode(index))
        distancia_metros = solution.ObjectiveValue()
        return ruta, distancia_metros
    return None, 0

# --- RUTAS DE FLASK ---

@app.route('/')
def index():
    """Ruta principal: Renderiza la interfaz gráfica del mapa."""
    return render_template('index.html')

@app.route('/api/calcular', methods=['POST'])
def calcular_ruta():
    """Endpoint API: Recibe puntos del Front, procesa algoritmos y devuelve JSON."""
    data = request.get_json()
    
    # 1. El Frontend nos enviará la lista de puntos seleccionados y el índice de inicio
    puntos_seleccionados = data.get('puntos', [])
    inicio_idx = data.get('inicio_idx', 0)
    
    if len(puntos_seleccionados) < 2:
        return jsonify({'error': 'Debes seleccionar al menos 2 puntos'}), 400
        
    # 2. Consultar matriz de distancias viales reales (en metros) desde OSRM
    matriz_m = obtener_matriz_osrm_metros(puntos_seleccionados)
    if not matriz_m:
        return jsonify({'error': 'No se pudo conectar u obtener datos de OSRM'}), 500

    # 3. Ejecutar y cronometrar los 3 Algoritmos Manuales
    # Voraz
    t0 = time.time()
    r_vo, d_vo_m = algoritmo_voraz(matriz_m, inicio_idx)
    t_vo = time.time() - t0

    # Fuerza Bruta (Controlamos que no colapse si el usuario elige demasiadas fincas)
    if len(puntos_seleccionados) <= 10:
        t0 = time.time()
        r_fb, d_fb_m = algoritmo_fuerza_bruta(matriz_m, inicio_idx)
        t_fb = time.time() - t0
    else:
        r_fb, d_fb_m, t_fb = None, None, None  # Protegemos la CPU si son muchos puntos

    # Programación Dinámica
    t0 = time.time()
    r_pd, d_pd_m = algoritmo_dinamico(matriz_m, inicio_idx)
    t_pd = time.time() - t0

    # 4. Ejecutar y cronometrar Google OR-Tools
    t0 = time.time()
    r_go, d_go_m = resolver_google_ortools(matriz_m, inicio_idx)
    t_go = time.time() - t0

    # ---- Ordenar los puntos físicos según la mejor ruta obtenida ----
    mejor_ruta_indices = r_go if r_go else r_pd
    puntos_ordenados_fisicos = [puntos_seleccionados[idx] for idx in mejor_ruta_indices]
    
    # ---- Pedir a OSRM las curvas exactas de la carretera ----
    camino_carretera_real = obtener_geometria_ruta_real(puntos_ordenados_fisicos)

    # ---- INTEGRACIÓN NUEVA: Desglosar distancias y tiempos tramo por tramo ----
    tramos_info = []
    for i in range(len(mejor_ruta_indices) - 1):
        idx_origen = mejor_ruta_indices[i]
        idx_destino = mejor_ruta_indices[i+1]
        
        # Extraemos la distancia en metros de la matriz base calculada por OSRM
        distancia_tramo_m = matriz_m[idx_origen][idx_destino]
        distancia_tramo_km = round(distancia_tramo_m / 1000, 2)
        
        # Estimación de tiempo basada en una velocidad promedio típica de camión en Amazonas (40 km/h)
        # 40 km/h equivale a 11.11 metros por segundo
        tiempo_segundos = distancia_tramo_m / 7.92
        tiempo_minutos = round(tiempo_segundos / 60, 1)
        if tiempo_minutos < 1:
            tiempo_minutos = 1  # Evitamos que marque 0 minutos si las fincas están muy pegadas
            
        tramos_info.append({
            'distancia_km': distancia_tramo_km,
            'tiempo_min': tiempo_minutos
        })

    # 5. Construir la respuesta estructurada convirtiendo los resultados finales a Kilómetros
    respuesta = {
        'comparativa': [
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Algoritmo Voraz',
                'distancia_km': round(d_vo_m / 1000, 2) if d_vo_m else None,
                'tiempo_seg': round(t_vo, 6),
                'ruta_indices': r_vo
            },
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Fuerza Bruta',
                'distancia_km': round(d_fb_m / 1000, 2) if isinstance(d_fb_m, (int, float)) else "N/A (+10 puntos)",
                'tiempo_seg': round(t_fb, 6) if isinstance(t_fb, (int, float)) else "N/A",
                'ruta_indices': r_fb
            },
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Programación Dinámica',
                'distancia_km': round(d_pd_m / 1000, 2) if d_pd_m else None,
                'tiempo_seg': round(t_pd, 6),
                'ruta_indices': r_pd
            },
            {
                'proveedor': 'GOOGLE',
                'algoritmo': 'Voraz + Búsqueda Local (GLS)',
                'distancia_km': round(d_go_m / 1000, 2) if d_go_m else None,
                'tiempo_seg': round(t_go, 6),
                'ruta_indices': r_go
            }
        ],
        'camino_carretera_real': camino_carretera_real,
        'mejor_ruta_indices': mejor_ruta_indices,
        'tramos_info': tramos_info  # <-- Pasamos el desglose de métricas al Frontend
    }

    return jsonify(respuesta)

@app.route('/api/cargar-kml', methods=['POST'])
def cargar_kml():
    """Lee el archivo KML real seleccionado por el usuario y devuelve sus puntos."""
    data = request.get_json()
    archivo_nombre = data.get('archivo', '')
    
    # Construimos la ruta segura hacia la carpeta donde están tus KMLs
    ruta_kml = os.path.join(app.root_path, 'static', 'kml', archivo_nombre)
    
    # Usamos tu función de core_logistica para extraer los puntos reales
    puntos_reales = extraer_datos_kml(ruta_kml)
    
    if not puntos_reales:
        return jsonify({'error': f'No se encontraron puntos en el archivo {archivo_nombre} o el archivo no existe.'}), 404
        
    return jsonify(puntos_reales)

if __name__ == '__main__':
    # Ejecuta el servidor local en el puerto 5000
    app.run(debug=True, port=5000)