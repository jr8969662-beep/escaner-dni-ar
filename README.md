# 🇦🇷 Escáner de Documentos Sudamericanos

Escáner de documentos de identidad que funciona **100% en el navegador**.
Lee códigos de barras (QR, PDF417, Code128) y MRZ. Por defecto no sube nada: todo se procesa y se guarda en el dispositivo (la sincronización con Supabase está desactivada hasta que se configure).

## ✨ Características

- 📷 **Cámara en vivo** con auto-inicio y fallbacks
- 🔍 **Triple motor de lectura**: BarcodeDetector + ZXing + jsQR
- 🌎 **10 países sudamericanos** con detección estricta
- ⚠️ **Detección de país incorrecto**: muestra un modal si el documento no corresponde
- 📋 **Copiar datos** al portapapeles
- 📥 **Descargar JSON** del escaneo
- 💾 **Historial local** de los últimos 50 escaneos
- 🖼️ **Subir imagen** desde galería como alternativa
- 📱 **PWA instalable** en el celular
- 🎨 **Modo claro/oscuro**
- 🔔 **Sonido y vibración** al detectar
- 🛡️ **Local por defecto**: las imágenes no salen del dispositivo salvo que se active Supabase (ver sección Privacidad)

## 🌎 Países soportados

| País | Documento | Método | Fiabilidad |
|---|---|---|---|
| 🇦🇷 Argentina | DNI tarjeta (nuevo y viejo) | QR + PDF417 + MRZ | 🟢 Alta |
| 🇨🇱 Chile | Cédula de Identidad | PDF417 | 🟢 Alta |
| 🇺🇾 Uruguay | Cédula de Identidad | MRZ | 🟢 Alta |
| 🇵🇾 Paraguay | Cédula de Identidad Civil | MRZ | 🟢 Alta |
| 🇵🇪 Perú | DNI Electrónico | MRZ | 🟢 Alta |
| 🇧🇴 Bolivia | Cédula de Identidad | MRZ | 🟡 Media |
| 🇨🇴 Colombia | Cédula de Ciudadanía | MRZ | 🟡 Media |
| 🇪🇨 Ecuador | Cédula de Ciudadanía | MRZ | 🟡 Media |
| 🇻🇪 Venezuela | Cédula de Identidad | MRZ | 🟡 Media |
| 🇧🇷 Brasil | Pasaporte | MRZ | 🟢 Alta |

> ⚠️ **Nota sobre Brasil**: el RG brasileño varía por estado y no tiene un formato nacional único. Solo se lee el **pasaporte** (MRZ TD3 estándar).

## 🛠️ Tecnologías

| Librería | Uso |
|---|---|
| [ZXing-js](https://github.com/zxing-js/library) | Lectura de PDF417 y otros códigos de barras |
| [jsQR](https://github.com/cozmo/jsQR) | Lectura de QR (fallback) |
| [BarcodeDetector API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) | Detección nativa (rápida) |
| Web Audio API | Sonido al detectar |
| Vibration API | Vibración al detectar |

## 📦 Instalación local

```bash
git clone https://github.com/jr8969662-beep/escaner-dni-ar.git
cd escaner-dni-ar


## 🆕 DNI argentino nuevo (policarbonato, 2026)

- **Reverso**: QR denso + líneas MRZ (`<<<`) + OCR de domicilio, lugar de nacimiento y CUIL.
- **Frente**: sin código; se lee por OCR (apellido, nombre, sexo, nacionalidad, fechas, número y ejemplar). Si no se detecta ningún código con el documento quieto, la app prueba el frente automáticamente.

## 🔒 Privacidad y seguridad

- Los datos del DNI son personales (Ley 25.326). Si se activa Supabase: usar un bucket **privado**, RLS y login para el panel `admin.html`, pedir consentimiento y definir cuánto tiempo se conservan.
- Nunca subir al repositorio fotos ni datos reales de documentos (ni siquiera de prueba): usar datos ficticios.
