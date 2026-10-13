# 🇦🇷 Escáner de Documentos Sudamericanos

Escáner de documentos de identidad que funciona **100% en el navegador**.
Lee códigos de barras (QR, PDF417, Code128) y MRZ. Sin servidores. Sin subir imágenes. Todo local.

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
- 🛡️ **100% local**: las imágenes nunca salen del dispositivo

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
git clone https://github.com/jri896662-beep/escaner-dni-ar.git
cd escaner-dni-ar
