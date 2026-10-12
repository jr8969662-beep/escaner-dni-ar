/**
 * Lector NFC para el chip del nuevo DNI electrónico
 * Solo funciona en navegadores Android compatibles (Web NFC API)
 */

const NFCReader = (() => {

  function isSupported() {
    return 'NDEFReader' in window;
  }

  /**
   * Escucha un tag NFC y devuelve los registros leídos
   * @param {number} timeoutMs - Timeout en ms
   * @returns {Promise<Object>}
   */
  async function read(timeoutMs = 30000) {
    if (!isSupported()) {
      throw new Error('Web NFC no está soportado en este navegador. Se requiere Android con Chrome.');
    }

    const ndef = new NDEFReader();
    await ndef.scan();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Tiempo de lectura NFC agotado.'));
      }, timeoutMs);

      ndef.onreading = (event) => {
        clearTimeout(timeout);
        const decoder = new TextDecoder();
        const registros = [];

        for (const record of event.message.records) {
          try {
            let valor = null;
            if (record.recordType === 'text') {
              valor = decoder.decode(record.data);
            } else if (record.recordType === 'url') {
              valor = decoder.decode(record.data);
            } else {
              valor = Array.from(new Uint8Array(record.data)).join(' ');
            }
            registros.push({
              tipo: record.recordType,
              mediaType: record.mediaType,
              valor
            });
          } catch (e) {
            console.warn('Error leyendo registro NFC:', e);
          }
        }

        resolve({
          serialNumber: event.serialNumber,
          registros
        });
      };

      ndef.onreadingerror = () => {
        clearTimeout(timeout);
        reject(new Error('Error de lectura NFC.'));
      };
    });
  }

  return { isSupported, read };
})();
