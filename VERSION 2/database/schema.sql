-- Crear tabla de Precios de Combustible
CREATE TABLE precios_combustible (
    id SERIAL PRIMARY KEY,
    tipo_combustible VARCHAR(20) UNIQUE NOT NULL,
    precio_galon_soles NUMERIC(5,2) NOT NULL
);

-- Insertar precios por defecto
INSERT INTO precios_combustible (tipo_combustible, precio_galon_soles) VALUES
    ('Petroleo', 16.50),
    ('Gasolina', 18.20);

-- Crear tabla de Vehículos (Flota)
CREATE TABLE vehiculos (
    id SERIAL PRIMARY KEY,
    marca VARCHAR(100) NOT NULL,
    modelo VARCHAR(100) NOT NULL,
    placa VARCHAR(15) UNIQUE,
    capacidad_kg NUMERIC NOT NULL,
    consumo_galon_km NUMERIC NOT NULL, -- Cuántos galones consume por cada KM recorrido
    tipo_combustible VARCHAR(20) REFERENCES precios_combustible(tipo_combustible)
);

-- Insertar flota de ejemplo
INSERT INTO vehiculos (marca, modelo, placa, capacidad_kg, consumo_galon_km, tipo_combustible) VALUES
    ('Toyota', 'Hilux Pick-up', 'ABC-123', 1000, 0.03, 'Gasolina'), -- Cargas bajas
    ('Mitsubishi', 'Fuso Canter', 'XYZ-987', 4000, 0.08, 'Petroleo'), -- Camión Mediano
    ('Volvo', 'FMX Dos Ejes', 'TRK-555', 15000, 0.15, 'Petroleo'); -- Camión Pesado

-- Crear tabla de Historial de Cargas Programadas
CREATE TABLE historial_cargas (
    id SERIAL PRIMARY KEY,
    finca_nombre VARCHAR(255) NOT NULL,
    fecha DATE NOT NULL,
    cantidad_kg INT NOT NULL,
    UNIQUE(finca_nombre, fecha)
);

-- Crear tabla de Usuarios (Roles)
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(150),
    rol VARCHAR(20) NOT NULL
);

-- Crear tabla de Registro de Viajes
CREATE TABLE viajes_registro (
    id SERIAL PRIMARY KEY,
    conductor_id INT NOT NULL REFERENCES usuarios(id),
    fecha DATE NOT NULL,
    vehiculo_id INT NOT NULL REFERENCES vehiculos(id),
    kg_totales NUMERIC NOT NULL,
    hora_inicio TIMESTAMP NOT NULL,
    hora_fin TIMESTAMP,
    estado VARCHAR(20) NOT NULL
);
