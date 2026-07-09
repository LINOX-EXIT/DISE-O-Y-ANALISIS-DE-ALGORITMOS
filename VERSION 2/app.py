import os
import time
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from werkzeug.security import check_password_hash, generate_password_hash

# Importamos las funciones que guardaste en core_logistica.py
from core_logistica import (
    extraer_datos_kml,
    obtener_matriz_osrm_metros,
    algoritmo_voraz,
    algoritmo_fuerza_bruta,
    algoritmo_dinamico,
    algoritmo_backtracking
)

# Importaciones para Google OR-Tools
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

app = Flask(__name__)
app.secret_key = 'super_secret_key_tms_amazonas' # Cambiar en producción

# Configuración de BD (Idealmente variables de entorno en producción)
DB_CONFIG = {
    'dbname': 'tms_amazonas',
    'user': 'postgres',
    'password': 'LINOXEXITr150321', # El usuario deberá actualizar esto
    'host': 'localhost',
    'port': '5432'
}

def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)

# --- DECORADORES DE SEGURIDAD ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def role_required(role):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user_id' not in session:
                return redirect(url_for('login'))
            if session.get('rol') != role and session.get('rol') != 'Admin':
                # Si no es el rol requerido ni es admin
                return jsonify({"error": "No tienes permiso para acceder a este recurso"}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

@app.after_request
def add_header(response):
    """Evitar que el navegador almacene en caché las páginas para que los roles se apliquen correctamente."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# --- RUTAS DE AUTENTICACIÓN ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM usuarios WHERE username = %s", (username,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if user and check_password_hash(user['password_hash'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['rol'] = user['rol']
            
            if user['rol'] == 'Despachador':
                return redirect(url_for('cargas_view'))
            if user['rol'] == 'Admin':
                return redirect(url_for('admin_dashboard'))
            return redirect(url_for('mapa_rutas'))
        else:
            return render_template('login.html', error='Credenciales incorrectas')
            
    # Si ya está logueado, redirigir
    if 'user_id' in session:
        if session.get('rol') == 'Despachador':
            return redirect(url_for('cargas_view'))
        if session.get('rol') == 'Admin':
            return redirect(url_for('admin_dashboard'))
        return redirect(url_for('mapa_rutas'))
        
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

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

# --- MERGE SORT PARA ORDENAR RESULTADOS EN EL BACKEND ---
def merge_sort_resultados(arr):
    if len(arr) <= 1:
        return arr
        
    mid = len(arr) // 2
    left = merge_sort_resultados(arr[:mid])
    right = merge_sort_resultados(arr[mid:])
    
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    
    while i < len(left) and j < len(right):
        val_l = left[i].get('distancia_km')
        val_r = right[j].get('distancia_km')
        
        # Considerar valores no numéricos (ej. "N/A") como infinitos
        num_l = val_l if isinstance(val_l, (int, float)) else float('inf')
        num_r = val_r if isinstance(val_r, (int, float)) else float('inf')
        
        if num_l <= num_r:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
            
    result.extend(left[i:])
    result.extend(right[j:])
    return result

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
    if 'user_id' in session:
        if session.get('rol') == 'Despachador':
            return redirect(url_for('cargas_view'))
        if session.get('rol') == 'Admin':
            return redirect(url_for('admin_dashboard'))
        return redirect(url_for('mapa_rutas'))
    return redirect(url_for('login'))

@app.route('/rutas')
@login_required
def mapa_rutas():
    """Ruta principal (Dashboard) con el mapa Leaflet."""
    if session.get('rol') == 'Despachador':
        return redirect(url_for('cargas_view'))
    if session.get('rol') == 'Admin':
        return redirect(url_for('admin_dashboard'))
        
    # Le pasamos el rol a la plantilla para la barra de navegación
    return render_template('index.html', user_role=session.get('rol'))

@app.route('/dashboard')
@login_required
def dashboard_analytics():
    """Ruta de Dashboard Analítico del TMS."""
    return render_template('dashboard.html', user_role=session.get('rol'))

@app.route('/admin_dashboard')
@login_required
@role_required('Admin')
def admin_dashboard():
    """Dashboard Administrativo Principal (Pestañas)."""
    return render_template('admin_dashboard.html', user_role=session.get('rol'))

@app.route('/configuracion')
@login_required
@role_required('Admin')
def configuracion():
    """Ruta de la vista de Configuración (Vehículos y Precios)."""
    return render_template('configuracion.html', user_role=session.get('rol'))

@app.route('/cargas')
@login_required
@role_required('Despachador')
def cargas_view():
    """Ruta de la vista de Gestión de Cargas (Fincas)."""
    return render_template('cargas.html', user_role=session.get('rol'))

@app.route('/api/calcular', methods=['POST'])
@login_required
def calcular_ruta():
    """Endpoint API: Recibe puntos del Front, procesa algoritmos y devuelve JSON."""
    data = request.get_json()
    
    # 1. El Frontend nos enviará la lista de puntos seleccionados, índice, y metadatos de TMS
    puntos_seleccionados = data.get('puntos', [])
    inicio_idx = data.get('inicio_idx', 0)
    fecha = data.get('fecha')
    
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

    # Backtracking (Controlamos hasta 12 puntos)
    if len(puntos_seleccionados) <= 12:
        t0 = time.time()
        r_bt, d_bt_m = algoritmo_backtracking(matriz_m, inicio_idx)
        t_bt = time.time() - t0
    else:
        r_bt, d_bt_m, t_bt = None, None, None

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

    # ---- Desglosar distancias y tiempos tramo por tramo ----
    tramos_info = []
    for i in range(len(mejor_ruta_indices) - 1):
        idx_origen = mejor_ruta_indices[i]
        idx_destino = mejor_ruta_indices[i+1]
        
        distancia_tramo_m = matriz_m[idx_origen][idx_destino]
        distancia_tramo_km = round(distancia_tramo_m / 1000, 2)
        
        # Estimación basada en velocidad promedio típica de camión en Amazonas (40 km/h = 11.11 m/s)
        tiempo_segundos = distancia_tramo_m / 11.11
        tiempo_minutos = round(tiempo_segundos / 60, 1)
        if tiempo_minutos < 1:
            tiempo_minutos = 1
            
        tramos_info.append({
            'distancia_km': distancia_tramo_km,
            'tiempo_min': tiempo_minutos
        })

    # 4.5 Lógica de TMS (Base de datos PostgreSQL)
    carga_total_kg = 0
    vehiculo_asignado = None
    precio_combustible_db = 16.50 # default fallback
    
    if fecha and len(puntos_seleccionados) > 0:
        try:
            conn = get_db_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Sumar la carga de las fincas para esa fecha
            fincas_nombres = tuple([p['nombre'] for p in puntos_seleccionados])
            if fincas_nombres:
                query = "SELECT COALESCE(SUM(cantidad_kg), 0) as total_kg FROM historial_cargas WHERE fecha = %s AND finca_nombre IN %s"
                cursor.execute(query, (fecha, fincas_nombres))
                res_carga = cursor.fetchone()
                carga_total_kg = res_carga['total_kg'] if res_carga else 0
                
            # Buscar el camión más rentable que soporte la carga total
            if carga_total_kg > 0:
                cursor.execute('''
                    SELECT v.*, p.precio_galon_soles, (v.consumo_galon_km * p.precio_galon_soles) as costo_por_km
                    FROM vehiculos v
                    JOIN precios_combustible p ON v.tipo_combustible = p.tipo_combustible
                    WHERE v.capacidad_kg >= %s 
                    ORDER BY costo_por_km ASC, v.capacidad_kg ASC 
                    LIMIT 1
                ''', (carga_total_kg,))
                vehiculo_asignado = cursor.fetchone()
                
                if not vehiculo_asignado:
                    # Si la carga excede al camión más grande, asignar el más grande global
                    cursor.execute('''
                        SELECT v.*, p.precio_galon_soles 
                        FROM vehiculos v
                        JOIN precios_combustible p ON v.tipo_combustible = p.tipo_combustible
                        ORDER BY v.capacidad_kg DESC LIMIT 1
                    ''')
                    vehiculo_asignado = cursor.fetchone()
            else:
                # Si no hay carga, asignar el camión más pequeño para que no crashee
                cursor.execute('''
                    SELECT v.*, p.precio_galon_soles 
                    FROM vehiculos v
                    JOIN precios_combustible p ON v.tipo_combustible = p.tipo_combustible
                    ORDER BY v.capacidad_kg ASC LIMIT 1
                ''')
                vehiculo_asignado = cursor.fetchone()
                
            if vehiculo_asignado:
                precio_combustible_db = float(vehiculo_asignado['precio_galon_soles'])
                
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"Error de base de datos en cálculo TMS: {e}")

    # Helper para calcular el costo en Soles
    def calcular_costo(dist_km):
        if dist_km is None or not isinstance(dist_km, (int, float)) or not vehiculo_asignado:
            return None
        return round(dist_km * float(vehiculo_asignado['consumo_galon_km']) * precio_combustible_db, 2)

    # 5. Construir la respuesta estructurada convirtiendo los resultados finales a Kilómetros
    respuesta = {
        'comparativa': [
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Algoritmo Voraz',
                'distancia_km': round(d_vo_m / 1000, 2) if d_vo_m else None,
                'tiempo_seg': round(t_vo, 6),
                'ruta_indices': r_vo,
                'costo_operativo_soles': calcular_costo(d_vo_m / 1000 if d_vo_m else None)
            },
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Fuerza Bruta',
                'distancia_km': round(d_fb_m / 1000, 2) if isinstance(d_fb_m, (int, float)) else "N/A (+10 puntos)",
                'tiempo_seg': round(t_fb, 6) if isinstance(t_fb, (int, float)) else "N/A",
                'ruta_indices': r_fb,
                'costo_operativo_soles': calcular_costo(d_fb_m / 1000 if isinstance(d_fb_m, (int, float)) else None)
            },
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Programación Dinámica',
                'distancia_km': round(d_pd_m / 1000, 2) if d_pd_m else None,
                'tiempo_seg': round(t_pd, 6),
                'ruta_indices': r_pd,
                'costo_operativo_soles': calcular_costo(d_pd_m / 1000 if d_pd_m else None)
            },
            {
                'proveedor': 'MANUAL',
                'algoritmo': 'Backtracking (Poda)',
                'distancia_km': round(d_bt_m / 1000, 2) if isinstance(d_bt_m, (int, float)) else "N/A (+12 puntos)",
                'tiempo_seg': round(t_bt, 6) if isinstance(t_bt, (int, float)) else "N/A",
                'ruta_indices': r_bt,
                'costo_operativo_soles': calcular_costo(d_bt_m / 1000 if isinstance(d_bt_m, (int, float)) else None)
            },
            {
                'proveedor': 'GOOGLE',
                'algoritmo': 'Voraz + Búsqueda Local (GLS)',
                'distancia_km': round(d_go_m / 1000, 2) if d_go_m else None,
                'tiempo_seg': round(t_go, 6),
                'ruta_indices': r_go,
                'costo_operativo_soles': calcular_costo(d_go_m / 1000 if d_go_m else None)
            }
        ],
        'camino_carretera_real': camino_carretera_real,
        'mejor_ruta_indices': mejor_ruta_indices,
        'tramos_info': tramos_info,
        'tms': {
            'carga_total_kg': carga_total_kg,
            'vehiculo_asignado': vehiculo_asignado
        }
    }

    # Ordenar los resultados de menor a mayor distancia usando nuestro MERGE SORT
    respuesta['comparativa'] = merge_sort_resultados(respuesta['comparativa'])

    return jsonify(respuesta)

@app.route('/api/guardar-carga-diaria', methods=['POST'])
def guardar_carga_diaria():
    """Recibe la fecha y los KGs de las fincas para guardarlos en la BD."""
    data = request.get_json()
    fecha = data.get('fecha')
    cargas = data.get('cargas', [])
    
    if not fecha or not cargas:
        return jsonify({"error": "Faltan datos de fecha o cargas"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        for c in cargas:
            cursor.execute('''
                INSERT INTO historial_cargas (finca_nombre, fecha, cantidad_kg)
                VALUES (%s, %s, %s)
                ON CONFLICT (finca_nombre, fecha) 
                DO UPDATE SET cantidad_kg = EXCLUDED.cantidad_kg
            ''', (c['finca_nombre'], fecha, c['cantidad_kg']))
        conn.commit()
        return jsonify({"status": "success", "message": "Cargas registradas correctamente."})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

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

@app.route('/api/cargas-por-fecha', methods=['GET'])
@login_required
def obtener_cargas_fecha():
    """Devuelve un diccionario {nombre_finca: cantidad_kg} para una fecha específica."""
    fecha = request.args.get('fecha')
    if not fecha:
        return jsonify({})
        
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute("SELECT finca_nombre, cantidad_kg FROM historial_cargas WHERE fecha = %s", (fecha,))
        filas = cursor.fetchall()
        cargas = {fila['finca_nombre']: fila['cantidad_kg'] for fila in filas}
        return jsonify(cargas)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# --- ENDPOINTS PARA CONFIGURACIÓN (TMS) ---

@app.route('/api/configuracion', methods=['GET'])
def get_configuracion():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute('SELECT * FROM precios_combustible')
        precios = cursor.fetchall()
        
        cursor.execute('SELECT * FROM vehiculos ORDER BY id ASC')
        vehiculos = cursor.fetchall()
        
        return jsonify({"precios": precios, "vehiculos": vehiculos})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/precios', methods=['POST'])
def update_precio():
    data = request.get_json()
    tipo = data.get('tipo_combustible')
    precio = data.get('precio_galon_soles')
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE precios_combustible SET precio_galon_soles = %s 
            WHERE tipo_combustible = %s
        ''', (precio, tipo))
        conn.commit()
        return jsonify({"message": f"Precio de {tipo} actualizado a S/ {precio}."})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/vehiculos', methods=['POST'])
def crear_vehiculo():
    data = request.get_json()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO vehiculos (marca, modelo, placa, capacidad_kg, consumo_galon_km, tipo_combustible)
            VALUES (%s, %s, %s, %s, %s, %s)
        ''', (data['marca'], data['modelo'], data.get('placa', 'S/N'), data['capacidad_kg'], data['consumo_galon_km'], data['tipo_combustible']))
        conn.commit()
        return jsonify({"message": "Vehículo registrado correctamente."})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/vehiculos/<int:v_id>', methods=['DELETE'])
@login_required
@role_required('Admin')
def eliminar_vehiculo(v_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM vehiculos WHERE id = %s', (v_id,))
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# --- RUTAS DE GESTIÓN DE USUARIOS ---
@app.route('/api/usuarios', methods=['GET', 'POST'])
@login_required
@role_required('Admin')
def gestion_usuarios():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    if request.method == 'GET':
        cursor.execute('SELECT id, username, nombre_completo, rol FROM usuarios ORDER BY id')
        usuarios = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({"usuarios": usuarios})
        
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        rol = data.get('rol')
        nombre_completo = data.get('nombre_completo', '')
        
        if not username or not password or not rol:
            return jsonify({"error": "Faltan datos requeridos (usuario, contraseña, rol)"}), 400
            
        hashed_pw = generate_password_hash(password)
        try:
            cursor.execute(
                'INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (%s, %s, %s, %s)',
                (username, hashed_pw, nombre_completo, rol)
            )
            conn.commit()
            return jsonify({"status": "success", "message": "Usuario creado"})
        except psycopg2.errors.UniqueViolation:
            conn.rollback()
            return jsonify({"error": "El nombre de usuario ya existe"}), 400
        except Exception as e:
            conn.rollback()
            return jsonify({"error": str(e)}), 500
        finally:
            cursor.close()
            conn.close()

@app.route('/api/usuarios/<int:u_id>', methods=['PUT'])
@login_required
@role_required('Admin')
def actualizar_usuario(u_id):
    data = request.get_json()
    username = data.get('username')
    nombre_completo = data.get('nombre_completo')
    password = data.get('password') # Opcional
    rol = data.get('rol')
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        if password:
            hashed_pw = generate_password_hash(password)
            cursor.execute(
                'UPDATE usuarios SET username = %s, nombre_completo = %s, rol = %s, password_hash = %s WHERE id = %s',
                (username, nombre_completo, rol, hashed_pw, u_id)
            )
        else:
            cursor.execute(
                'UPDATE usuarios SET username = %s, nombre_completo = %s, rol = %s WHERE id = %s',
                (username, nombre_completo, rol, u_id)
            )
        conn.commit()
        return jsonify({"status": "success", "message": "Usuario actualizado"})
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return jsonify({"error": "El nombre de usuario ya está en uso"}), 400
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/usuarios/<int:u_id>', methods=['DELETE'])
@login_required
@role_required('Admin')
def eliminar_usuario(u_id):
    # Evitar que el admin se borre a sí mismo
    if u_id == session.get('user_id'):
        return jsonify({"error": "No puedes eliminar tu propia cuenta"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM usuarios WHERE id = %s', (u_id,))
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# --- FIN RUTAS GESTIÓN USUARIOS ---

# --- ENDPOINTS PARA CARGAS ---

@app.route('/api/cargas', methods=['GET'])
def get_cargas():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute('SELECT * FROM historial_cargas ORDER BY fecha DESC, id DESC')
        cargas = cursor.fetchall()
        return jsonify(cargas)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/cargas/<int:c_id>', methods=['DELETE'])
@login_required
@role_required('Despachador')
def eliminar_carga(c_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM historial_cargas WHERE id = %s', (c_id,))
        conn.commit()
        return jsonify({"status": "success", "message": "Carga eliminada"})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

# --- RUTAS DE GESTIÓN DE VIAJES (CONDUCTOR Y ADMIN) ---
@app.route('/api/viaje/iniciar', methods=['POST'])
@login_required
def iniciar_viaje():
    # Solo el conductor puede iniciar
    if session.get('rol') != 'Conductor':
        return jsonify({"error": "No tienes permisos"}), 403
        
    data = request.get_json()
    vehiculo_id = data.get('vehiculo_id')
    kg_totales = data.get('kg_totales')
    
    if not vehiculo_id or kg_totales is None:
        return jsonify({"error": "Faltan datos del vehículo o carga"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Insertar viaje en estado en_progreso
        cursor.execute(
            """INSERT INTO viajes_registro 
               (conductor_id, fecha, vehiculo_id, kg_totales, hora_inicio, estado) 
               VALUES (%s, CURRENT_DATE, %s, %s, CURRENT_TIMESTAMP, 'en_progreso') RETURNING id, hora_inicio""",
            (session.get('user_id'), vehiculo_id, kg_totales)
        )
        viaje = cursor.fetchone()
        conn.commit()
        return jsonify({
            "status": "success", 
            "viaje_id": viaje[0], 
            "hora_inicio": viaje[1].isoformat()
        })
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/viaje/finalizar', methods=['POST'])
@login_required
def finalizar_viaje():
    if session.get('rol') != 'Conductor':
        return jsonify({"error": "No tienes permisos"}), 403
        
    data = request.get_json()
    viaje_id = data.get('viaje_id')
    
    if not viaje_id:
        return jsonify({"error": "ID de viaje no proporcionado"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE viajes_registro SET hora_fin = CURRENT_TIMESTAMP, estado = 'finalizado' WHERE id = %s AND conductor_id = %s RETURNING hora_fin",
            (viaje_id, session.get('user_id'))
        )
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"error": "Viaje no encontrado o no pertenece a este conductor"}), 404
            
        conn.commit()
        return jsonify({"status": "success", "hora_fin": row[0].isoformat()})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/viajes', methods=['GET'])
@login_required
@role_required('Admin')
def obtener_viajes():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT v.id, v.fecha, v.kg_totales, v.hora_inicio, v.hora_fin, v.estado,
                   u.username as conductor_username, u.nombre_completo as conductor_nombre,
                   veh.marca as vehiculo_marca, veh.modelo as vehiculo_modelo, veh.placa as vehiculo_placa
            FROM viajes_registro v
            JOIN usuarios u ON v.conductor_id = u.id
            JOIN vehiculos veh ON v.vehiculo_id = veh.id
            ORDER BY v.hora_inicio DESC
        """
        cursor.execute(query)
        viajes = cursor.fetchall()
        
        # Formatear fechas y tiempos para JSON
        for v in viajes:
            v['fecha'] = v['fecha'].isoformat() if v['fecha'] else None
            v['hora_inicio'] = v['hora_inicio'].isoformat() if v['hora_inicio'] else None
            v['hora_fin'] = v['hora_fin'].isoformat() if v['hora_fin'] else None
            
        return jsonify({"viajes": viajes})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/historial_rutas')
@login_required
@role_required('Conductor')
def historial_rutas():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute('''
            SELECT v.id, v.fecha, v.kg_totales, v.hora_inicio, v.hora_fin, v.estado,
                   veh.marca, veh.modelo, veh.placa
            FROM viajes_registro v
            JOIN vehiculos veh ON v.vehiculo_id = veh.id
            WHERE v.conductor_id = %s
            ORDER BY v.hora_inicio DESC
        ''', (session.get('user_id'),))
        viajes = cursor.fetchall()
        return render_template('historial_rutas.html', viajes=viajes, user_role=session.get('rol'))
    except Exception as e:
        return str(e)
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    # Ejecuta el servidor local en el puerto 5000
    app.run(debug=True, port=5000)