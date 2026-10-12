/**
 * Lector NFC para el chip del DNI electrónico (Android Chrome)
 */

const NFCReader = (() => {

  function isSupported() {
    return 'NDEFReader' in window;
  }

  async function read(timeoutMs = 30000) {
    if (!isSupported()) {
      throw new Error('Web NFC no está soportado en este navegador.');
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
            if (record.recordType === 'text' || record.recordType === 'url') {
              valor = decoder.decode(record.data);
            } else {
              valor = Array.from(new Uint8Array(record.data)).join(' ');
            }
            registros.push({ tipo: record.recordType, valor });
          } catch (e) {}
        }
        resolve({ serialNumber: event.serialNumber, registros });
      };

      ndef.onreadingerror = () => {
        clearTimeout(timeout);
        reject(new Error('Error de lectura NFC.'));
      };
    });
  }

  return { isSupported, read };
})();
