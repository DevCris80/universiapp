# Cambios Funcionales — Backend

## 1. Editar viaje (información y ubicación)

El conductor puede editar un viaje existente mientras esté activo y no tenga solicitudes aceptadas.

**Nuevas rutas:**
- `GET /viaje/:id/editar` — formulario pre-cargado con datos actuales
- `POST /viaje/:id/editar` — guarda los cambios (dirección, ubicación, vehículo, tarifa, hora, cupos, tipo de servicio)

Solo el conductor que creó el viaje puede editarlo.

---

## 2. Tipo de servicio: "Universidad" / "Destino"

Se agrega el campo `tipo_servicio` a la tabla `viajes` con dos valores posibles:

- `universidad` — viaje hacia la Universidad Católica
- `destino` — viaje hacia la ubicación que indique el conductor

Esto permite que los pasajeros sepan si el viaje va hacia el campus o hacia otro lado.

**Cambios:**
- Migración de base de datos: columna `tipo_servicio` con CHECK
- El formulario de crear/editar viaje ahora pide seleccionar el tipo
- El endpoint `/api/viajes` devuelve el tipo de servicio
- En el perfil y detalle se muestra el tipo

---

## 3. Cancelar viaje después de aceptar

Tanto el conductor como el pasajero pueden cancelar una solicitud que ya fue aceptada.

**Nuevo estado en solicitudes:** `cancelada`

**Nueva ruta:**
- `POST /viaje/:id/cancelar` — cancela la solicitud aceptada

**Efectos al cancelar:**
- La solicitud pasa a estado `cancelada`
- El viaje se reactiva (`activo = 1`)
- Los cupos se restablecen (se incrementa en 1)
- Otras solicitudes pendientes quedan igual (no se rechazan automáticamente)
- Ambos usuarios dejan de ver el teléfono del otro

**Validaciones:**
- Solo pueden cancelar el conductor del viaje o el pasajero de la solicitud aceptada
- Solo se puede cancelar si hay una solicitud en estado `aceptada`
