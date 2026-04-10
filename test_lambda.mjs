// Test simple de la Lambda URL
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const LAMBDA_URL = 'https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/';

async function test() {
  console.log('Test 1: GET simple...');
  try {
    const r1 = await fetch(LAMBDA_URL);
    console.log('Status GET:', r1.status);
    console.log('Body GET:', await r1.text());
  } catch(e) { console.log('Erreur GET:', e.message); }

  console.log('\nTest 2: POST avec contracts vide...');
  try {
    const r2 = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ contracts: [] })
    });
    console.log('Status POST:', r2.status);
    console.log('Headers:', Object.fromEntries(r2.headers));
    console.log('Body POST:', await r2.text());
  } catch(e) { console.log('Erreur POST:', e.message); }

  console.log('\nTest 3: POST avec 1 contrat test...');
  try {
    const r3 = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contracts: [{
          ref: 'AI0304261103942/1',
          etat: 'Validé & Signé',
          type: 'CI',
          agence: 'AIN SEBAA HAY MOHAMMADI'
        }] 
      })
    });
    console.log('Status:', r3.status);
    console.log('Body:', await r3.text());
  } catch(e) { console.log('Erreur:', e.message); }
}

test();
