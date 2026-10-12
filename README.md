# escaner-dni-ar
Escáner de DNI argentino (PDF417 + OCR + NFC) en el navegador
# 🇦🇷 DNI Scanner AR

Escáner de DNI argentino que funciona **100% en el navegador**.
Lee el código **PDF417** del frente, aplica **OCR** como respaldo y
opcionalmente lee el **chip NFC** del nuevo DNI electrónico.

> ⚠️ **Aviso legal**: Esta herramienta es solo para fines educativos y de
> uso personal. El tratamiento de datos personales debe cumplir con la
> **Ley 25.326 de Protección de Datos Personales** de Argentina.

## ✨ Características

- 📷 **PDF417**: lectura del código de barras 2D del anverso (fiabilidad 99.9%)
- 🔍 **OCR**: respaldo con Tesseract.js para el frente del documento
- 📡 **NFC**: soporte experimental para el chip del DNI electrónico (Android)
- 🔐 **Validaciones locales**: DNI, CUIL (módulo 11), fechas, edad
- 🛡️ **100% en el cliente**: las imágenes nunca salen del dispositivo
- 📱 **Responsive**: funciona en móvil y escritorio

## 🚀 Demo

👉 [Ver demo](https://TU-USUARIO.github.io/dni-scanner/)

## 🛠️ Tecnologías

| Librería | Uso |
|---|---|
| [ZXing-js](https://github.com/zxing-js/library) | Decodificación del PDF417 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | OCR en el navegador |
| Web NFC API | Lectura del chip (Android Chrome) |

## 📦 Instalación

```bash
git clone https://github.com/TU-USUARIO/dni-scanner.git
cd dni-scanner
