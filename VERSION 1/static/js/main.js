// 1. Inicializar el mapa centrado en Amazonas (Chachapoyas)
const map = L.map('map').setView([-6.2295, -77.8712], 9);

// Cargar capa base de OpenStreetMap (Mapas gratuitos)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Variables globales para el manejo de capas
let marcadoresGroup = L.layerGroup().addTo(map);
let rutaLineasGroup = L.layerGroup().addTo(map);
let todasLasFincas = []; // Aquí se guardarán los puntos REALES que devuelva Python

// 2. Detectar cambio de Provincia en el Selector y pedir datos reales al Backend
document.getElementById('selector-kml').addEventListener('change', function (e) {
    const archivoKml = e.target.value;
    const listaDiv = document.getElementById('lista-fincas');

    // Limpiar mapa y panel de control por completo
    marcadoresGroup.clearLayers();
    rutaLineasGroup.clearLayers();
    listaDiv.innerHTML = "";
    todasLasFincas = [];

    if (!archivoKml) {
        listaDiv.innerHTML = '<p style="color: #95a5a6; font-style: italic;">Selecciona una provincia para cargar las fincas...</p>';
        return;
    }

    listaDiv.innerHTML = '<p style="color: #3498db; font-style: italic;">Leyendo archivo KML real...</p>';

    // Hacemos la petición al Backend para que lea el archivo KML del disco
    fetch('/api/cargar-kml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivo: archivoKml })
    })
        .then(response => response.json())
        .then(puntos => {
            if (puntos.error) {
                listaDiv.innerHTML = `<p style="color: #e74c3c;">❌ ${puntos.error}</p>`;
                return;
            }

            todasLasFincas = puntos;
            listaDiv.innerHTML = ""; // Limpiar mensaje de carga

            // Enfocar el mapa automáticamente en el primer punto del archivo KML real (Centro de Acopio)
            if (todasLasFincas.length > 0) {
                map.setView([todasLasFincas[0].lat, todasLasFincas[0].lng], 10);
            }

            // Dibujar los checkboxes laterales y los marcadores en el mapa
            todasLasFincas.forEach((finca, index) => {
                // Crear elemento en la lista lateral
                const item = document.createElement('div');
                item.className = 'finca-item';
                item.innerHTML = `
                <input type="checkbox" id="chk-${index}" value="${index}" checked>
                <label for="chk-${index}">${finca.nombre}</label>
            `;
                listaDiv.appendChild(item);

                // Determinar color (Verde para el punto de inicio/Empresa, Azul para las fincas)
                const colorIcono = index === 0 ? 'green' : 'blue';
                const marker = L.marker([finca.lat, finca.lng], {
                    icon: L.icon({
                        iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${colorIcono}.png`,
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [1, -34],
                        shadowSize: [41, 41]
                    })
                }).bindPopup(`<b>${finca.nombre}</b><br>Lat: ${finca.lat}<br>Lng: ${finca.lng}`);

                marcadoresGroup.addLayer(marker);
            });
        })
        .catch(error => {
            console.error("Error al cargar KML:", error);
            listaDiv.innerHTML = '<p style="color: #e74c3c;">❌ Error al conectar con el lector KML.</p>';
        });
});

// 3. EVENTO CLIC: Enviar datos seleccionados dinámicamente a la API de cálculo
document.getElementById('btn-calcular').addEventListener('click', function () {
    rutaLineasGroup.clearLayers(); // Limpiar el trazo de la carretera anterior

    // Limpiar tooltips de turnos anteriores para que no se dupliquen ni se queden congelados
    marcadoresGroup.eachLayer(function (layer) {
        if (layer.unbindTooltip) {
            layer.unbindTooltip();
        }
    });

    // Filtrar únicamente los puntos que el usuario dejó seleccionados
    const puntosAEnviar = [];
    todasLasFincas.forEach((finca, index) => {
        const chk = document.getElementById(`chk-${index}`);
        if (chk && chk.checked) {
            puntosAEnviar.push(finca);
        }
    });

    if (puntosAEnviar.length < 2) {
        alert("Por favor, selecciona al menos 2 puntos (Empresa + 1 Finca).");
        return;
    }

    document.getElementById('resultados-tabla').innerHTML = '<p style="color: #3498db; font-weight: bold;">⚡ Procesando algoritmos en el Backend...</p>';

    // Petición POST con el arreglo dinámico de puntos
    fetch('/api/calcular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            puntos: puntosAEnviar,
            inicio_idx: 0
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                document.getElementById('resultados-tabla').innerHTML = `<p style="color: #e74c3c;">❌ Error: ${data.error}</p>`;
                return;
            }

            // --- FUNCIÓN INTERNA: Convertir minutos u horas flotantes a formato amigable "X h Y min" ---
            const formatearTiempo = (minutosTotales) => {
                const horas = Math.floor(minutosTotales / 60);
                const minutos = Math.round(minutosTotales % 60);
                if (horas === 0) return `${minutos} min`;
                return `${horas} h ${minutos} min`;
            };

            // --- CONSTRUIR E IMPRIMIR TABLA COMPARATIVA ---
            let htmlTabla = `
            <table>
                <thead>
                    <tr>
                        <th>Algoritmo</th>
                        <th>Distancia</th>
                        <th>Tiempo (s)</th>
                    </tr>
                </thead>
                <tbody>
        `;

            data.comparativa.forEach(item => {
                const badge = item.proveedor === 'GOOGLE' ? 'badge-google' : 'badge-manual';
                const dist = typeof item.distancia_km === 'number' ? `${item.distancia_km} km` : item.distancia_km;
                htmlTabla += `
                <tr>
                    <td><span class="${badge}">${item.proveedor}</span><br>${item.algoritmo}</td>
                    <td><b>${dist}</b></td>
                    <td>${item.tiempo_seg}</td>
                </tr>
            `;
            });

            htmlTabla += `</tbody></table>`;
            document.getElementById('resultados-tabla').innerHTML = htmlTabla;

            // --- SELECCIONAR MÉTRICAS DEL MEJOR ALGORITMO (GOOGLE) ---
            // Buscamos la fila de Google en la comparativa; si no existe, tomamos la primera fila como respaldo.
            let mejorMetrica = data.comparativa.find(item => item.proveedor === 'GOOGLE');
            if (!mejorMetrica && data.comparativa.length > 0) {
                mejorMetrica = data.comparativa[0];
            }

            // Convertir el tiempo total de la mejor ruta a minutos para pasarlo por el formateador
            let tiempoTotalMinutos = 0;
            if (mejorMetrica) {
                // Si el backend te da el tiempo en segundos, lo dividimos entre 60
                tiempoTotalMinutos = mejorMetrica.tiempo_seg / 60;
            }

            // --- TRAZAR MEJOR RUTA REAL RECOGIENDO LAS CURVAS VIALES ---
            const coordenadasCamino = data.camino_carretera_real;
            const ordenIndices = data.mejor_ruta_indices;
            const infoTramos = data.tramos_info;

            if (coordenadasCamino && coordenadasCamino.length > 0) {
                // 1. Dibujar la línea base de la carretera siguiendo el trazado real
                const polilineas = L.polyline(coordenadasCamino, {
                    color: '#e74c3c',
                    weight: 6,
                    opacity: 0.85,
                    lineJoin: 'round'
                }).addTo(rutaLineasGroup);

                // 2. Recorrer la ruta secuencialmente para reconfigurar Popups y Tooltips tramo por tramo
                ordenIndices.forEach((indiceActual, posicionEnRuta) => {
                    const fincaActual = puntosAEnviar[indiceActual];

                    // Buscamos el objeto marcador gráfico correspondiente en el mapa por sus coordenadas
                    marcadoresGroup.eachLayer(function (layer) {
                        if (layer.getLatLng().lat === fincaActual.lat && layer.getLatLng().lng === fincaActual.lng) {

                            if (posicionEnRuta === 0) {
                                // --- CAPA INFORMATIVA CONSOLIDADA PARA EL CENTRO DE ACOPIO (Pin Verde) ---
                                let secuenciaTexto = "";
                                let rutaDeDondeADonde = "";

                                ordenIndices.forEach((idx, i) => {
                                    const flecha = i < ordenIndices.length - 1 ? " ➔ " : "";
                                    secuenciaTexto += `<span><b>${i + 1}.</b> ${puntosAEnviar[idx].nombre}</span>${flecha ? '<br>' : ''}`;
                                });

                                // Generar la cabecera simplificada "Desde -> Hasta" del recorrido total
                                if (ordenIndices.length > 1) {
                                    const puntoInicio = puntosAEnviar[ordenIndices[0]].nombre;
                                    const puntoFin = puntosAEnviar[ordenIndices[ordenIndices.length - 1]].nombre;
                                    rutaDeDondeADonde = `${puntoInicio} ➔ ${puntoFin}`;
                                }

                                const contenidoAcopio = `
                                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; min-width: 280px;">
                                    <h4 style="margin: 0 0 4px 0; color: #27ae60; padding-bottom: 2px; font-size: 1.05rem;">
                                        🟢 CENTRO DE ACOPIO
                                    </h4>
                                    
                                    <div style="background: #2c3e50; color: #ffffff; padding: 8px; border-radius: 5px; margin-bottom: 8px; font-size: 0.85rem; line-height: 1.4;">
                                        📍 <b>Ruta:</b> ${rutaDeDondeADonde}<br>
                                        ⏱️ <b>Tiempo Total de la Ruta:</b> ${formatearTiempo(tiempoTotalMinutos)}
                                    </div>

                                    <div style="background: #ebf7ee; border-left: 4px solid #2ecc71; padding: 6px; border-radius: 4px; margin-bottom: 8px; font-size: 0.8rem;">
                                        🛣️ <b>Distancia Total:</b> ${mejorMetrica ? mejorMetrica.distancia_km : 'N/A'} km<br>
                                        ⚙️ <b>Algoritmo seleccionado:</b> ${mejorMetrica ? mejorMetrica.algoritmo : 'Google API'}
                                    </div>

                                    <div style="font-size: 0.85rem; color: #2c3e50; line-height: 1.4;">
                                        📋 <b>Secuencia Completa a Seguir:</b><br>
                                        <div style="margin-top: 4px; padding: 6px; max-height: 110px; overflow-y:auto; border: 1px solid #e6e9ed; background: #fafbfc; border-radius: 4px;">
                                            ${secuenciaTexto}
                                        </div>
                                    </div>
                                </div>
                            `;

                                layer.bindPopup(contenidoAcopio).openPopup();
                            } else {
                                // --- POPUPS INTERMEDIOS DINÁMICOS (Pines Azules) ---
                                const indiceAnterior = ordenIndices[posicionEnRuta - 1];
                                const puntoAnterior = puntosAEnviar[indiceAnterior];
                                const tramoMetricas = infoTramos[posicionEnRuta - 1];

                                // Evaluamos si es físicamente el retorno final a la planta base
                                const esDestinoFinal = (posicionEnRuta === ordenIndices.length - 1 && indiceActual === 0);
                                const tituloPopup = esDestinoFinal ? `🏁 Retorno a Planta` : `📍 Turno #${posicionEnRuta} de Visita`;

                                const contenidoPopup = `
                                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; min-width: 220px;">
                                    <h4 style="margin: 0 0 8px 0; color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 3px; font-size: 1rem;">
                                        ${tituloPopup}
                                    </h4>
                                    <p style="margin: 4px 0; font-size: 0.85rem; color: #34495e;">
                                        <b>Desde:</b> ${puntoAnterior.nombre}<br>
                                        <b>Hacia:</b> ${fincaActual.nombre}
                                    </p>
                                    <div style="background: #f8f9fa; border-left: 4px solid #e74c3c; padding: 6px; border-radius: 4px; margin-top: 8px; font-size: 0.85rem;">
                                        🚗 <b>Distancia del tramo:</b> ${tramoMetricas.distancia_km} km<br>
                                        ⏱️ <b>Tiempo estimado:</b> ${formatearTiempo(tramoMetricas.tiempo_min)}
                                    </div>
                                    <p style="font-size: 0.7rem; color: #95a5a6; margin: 6px 0 0 0; text-align: right;">
                                        ${fincaActual.lat.toFixed(5)}, ${fincaActual.lng.toFixed(5)}
                                    </p>
                                </div>
                            `;

                                layer.bindPopup(contenidoPopup);

                                // Colocar el Tooltip flotante superior (Solo a paradas intermedias, no al retorno)
                                if (!esDestinoFinal) {
                                    layer.bindTooltip(`<b>Turno #${posicionEnRuta}</b>`, {
                                        permanent: true,
                                        direction: 'top',
                                        className: 'badge-orden'
                                    }).openTooltip();
                                }
                            }
                        }
                    });
                });

                // Encuadrar el zoom del mapa para capturar toda la carretera calculada
                map.fitBounds(polilineas.getBounds());

            } else {
                // Mecanismo de respaldo por línea recta si falla la conexión vial real
                alert("Nota: Mostrando ruta en línea recta debido a una interrupción con el servidor vial.");
                const coordenadasLineaRecta = [];
                ordenIndices.forEach(idx => {
                    const p = puntosAEnviar[idx];
                    coordenadasLineaRecta.push([p.lat, p.lng]);
                });

                const polilineasRectas = L.polyline(coordenadasLineaRecta, {
                    color: '#ef5350',
                    weight: 4,
                    dashArray: '5, 10'
                }).addTo(rutaLineasGroup);

                map.fitBounds(polilineasRectas.getBounds());
            }
        })
        .catch(error => {
            console.error("Error en el proceso de cálculo:", error);
            document.getElementById('resultados-tabla').innerHTML = `
            <div style="color: #e74c3c; padding: 10px; border: 1px solid #e74c3c; background: #fdf2f2; border-radius: 6px;">
                <b>❌ Error detectado en el Frontend:</b><br>
                <code style="display:block; margin-top:5px; font-family:monospace;">${error.message}</code>
            </div>
        `;
        });
});