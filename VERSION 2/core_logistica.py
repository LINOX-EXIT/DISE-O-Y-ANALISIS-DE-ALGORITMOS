import os
import requests
import itertools
import math
from pykml import parser

def extraer_datos_kml(ruta_archivo):
    """Lee un archivo KML y extrae los nombres y coordenadas de las fincas."""
    if not os.path.exists(ruta_archivo):
        return []
        
    with open(ruta_archivo, 'rt', encoding='utf-8') as f:
        root = parser.parse(f).getroot()
    
    puntos = []
    for pm in root.xpath('.//*[local-name()="Placemark"]'):
        try:
            nombre = str(pm.name).strip()
            coords_raw = str(pm.Point.coordinates).strip().split(',')
            
            puntos.append({
                'nombre': nombre,
                'lat': float(coords_raw[1]),
                'lng': float(coords_raw[0])
            })
        except AttributeError:
            # Ignora elementos del KML que no sean puntos (como rutas o polígonos)
            continue
            
    return puntos

def haversine(lat1, lon1, lat2, lon2):
    """Calcula la distancia en línea recta en metros entre dos coordenadas."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2.0)**2
    return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

def obtener_matriz_osrm_metros(puntos):
    """Consulta a OSRM y devuelve la matriz de distancias viales en metros."""
    if not puntos:
        return None
        
    coords_str = ";".join([f"{p['lng']},{p['lat']}" for p in puntos])
    url = f"http://router.project-osrm.org/table/v1/driving/{coords_str}?annotations=distance"
    
    matriz = None
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok':
                matriz = data['distances']
        else:
            print(f"OSRM bloqueó o rechazó la petición: HTTP {response.status_code}")
    except Exception as e:
        print(f"Error de conexión con OSRM: {e}")
        
    # FALLBACK: Si falla OSRM público, usar distancias matemáticas (Haversine)
    if not matriz:
        print("Activando Fallback: Usando Distancia Matemática (Haversine)")
        n = len(puntos)
        matriz = [[0]*n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i != j:
                    matriz[i][j] = haversine(puntos[i]['lat'], puntos[i]['lng'], puntos[j]['lat'], puntos[j]['lng'])
                    
    return matriz

# --- A. ALGORITMO VORAZ ---
def algoritmo_voraz(matriz, inicio):
    n = len(matriz); visitados = [False] * n; ruta = [inicio]
    visitados[inicio] = True; dist = 0; actual = inicio
    for _ in range(n - 1):
        siguiente = -1; d_min = float('inf')
        for i in range(n):
            if not visitados[i] and matriz[actual][i] < d_min:
                d_min = matriz[actual][i]; siguiente = i
        visitados[siguiente] = True; ruta.append(siguiente)
        dist += d_min; actual = siguiente
    dist += matriz[actual][inicio]; ruta.append(inicio)
    return ruta, dist

# --- B. FUERZA BRUTA ---
def algoritmo_fuerza_bruta(matriz, inicio):
    n = len(matriz); nodos = [i for i in range(n) if i != inicio]
    mejor_dist = float('inf'); mejor_ruta = []
    for perm in itertools.permutations(nodos):
        ruta = [inicio] + list(perm) + [inicio]
        d = sum(matriz[ruta[i]][ruta[i+1]] for i in range(len(ruta)-1))
        if d < mejor_dist: mejor_dist = d; mejor_ruta = ruta
    return mejor_ruta, mejor_dist

# --- C. PROGRAMACIÓN DINÁMICA ---
def algoritmo_dinamico(matriz, inicio):
    n = len(matriz); memo = {}
    def visitar(mask, pos):
        if mask == (1 << n) - 1: return matriz[pos][inicio], [pos, inicio]
        if (mask, pos) in memo: return memo[(mask, pos)]
        res = float('inf'); camino = []
        for sig in range(n):
            if (mask >> sig) & 1 == 0:
                d, c = visitar(mask | (1 << sig), sig)
                if matriz[pos][sig] + d < res:
                    res = matriz[pos][sig] + d; camino = [pos] + c
        memo[(mask, pos)] = (res, camino)
        return res, camino
    return visitar(1 << inicio, inicio)[1], visitar(1 << inicio, inicio)[0]

# --- D. BACKTRACKING CON PODA ---
def algoritmo_backtracking(matriz, inicio):
    n = len(matriz)
    mejor_distancia = [float('inf')]
    mejor_ruta = []
    
    def backtrack(nodo_actual, visitados, ruta_actual, dist_actual):
        # PODA: Si la distancia actual ya es mayor o igual a la mejor, cortamos esta rama
        if dist_actual >= mejor_distancia[0]:
            return
            
        # Caso base: todos visitados, volvemos al inicio
        if len(visitados) == n:
            dist_final = dist_actual + matriz[nodo_actual][inicio]
            if dist_final < mejor_distancia[0]:
                mejor_distancia[0] = dist_final
                # Guardamos una copia de la ruta + el regreso al inicio
                mejor_ruta.clear()
                mejor_ruta.extend(ruta_actual + [inicio])
            return
            
        # Caso recursivo: intentar visitar nodos no visitados
        for siguiente in range(n):
            if siguiente not in visitados:
                visitados.add(siguiente)
                ruta_actual.append(siguiente)
                
                backtrack(siguiente, visitados, ruta_actual, dist_actual + matriz[nodo_actual][siguiente])
                
                # Deshacer el cambio (backtrack)
                ruta_actual.pop()
                visitados.remove(siguiente)
                
    # Inicializamos la búsqueda desde el nodo de inicio
    visitados_ini = set([inicio])
    ruta_ini = [inicio]
    backtrack(inicio, visitados_ini, ruta_ini, 0)
    
    return mejor_ruta, mejor_distancia[0]