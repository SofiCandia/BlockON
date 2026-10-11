# BlockON

El diseñador crea una plantilla SVG. El sistema aplica automáticamente la identidad de marca del emprendedor (colores, textos y logo) mediante reglas y entrega un PNG listo para publicar.
El pago en XLM se divide en una transacción clásica de Stellar Testnet.

## Requisitos

- Node.js 20.9 o superior y npm.
- Freighter instalado, con una cuenta de prueba y la red seleccionada en **Stellar Testnet**.
- Acceso a internet para Horizon Testnet y Friendbot al preparar las cuentas.

La app solo configura `https://horizon-testnet.stellar.org` y `Networks.TESTNET`;
no uses fondos reales ni claves de Mainnet.

## Variables de entorno

El setup escribe `PLATFORM_PUBLIC_KEY` en `.env.local`. Configura ahí también:

| Variable | Requerida | Uso |
| --- | --- | --- |
| `PLATFORM_PUBLIC_KEY` | Sí | Wallet pública que recibe el 65%; la genera `testnet:setup`. |
| `PRICE_XLM` | Sí para pagar | Precio por post en XLM, con hasta 7 decimales y mayor que cero. |

`PLATFORM_SECRET_KEY` no es una variable de ejecución de la app. El script de
setup la guarda en `.env.setup.local`, solo para reutilizar la cuenta de
plataforma en futuras ejecuciones. También puede recibirse en el entorno del
proceso que ejecuta el script. No la copies a `.env.local`, al frontend ni al
repositorio. Si una ejecución antigua la dejó en `.env.local`, `testnet:setup`
la migra a `.env.setup.local` y la elimina de `.env.local`.

`.env*` y `storage/` están excluidos por `.gitignore`; `.env.example` no contiene
valores secretos. El setup genera las wallets demo y los datos bajo `storage/`.

## Instalar y ejecutar en local

```bash
npm install
npm run testnet:setup
npm run seed:templates
```

Después de `testnet:setup`, abre `.env.local` y configura `PRICE_XLM`. Inicia la
app:

```bash
npm run dev
```

Abre `http://localhost:3000`. Para compilar y revisar el código:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm test
```

El setup crea y fondea con Friendbot la wallet de plataforma y dos wallets
ficticias de diseñador. No fondea la wallet del emprendedor: usa Friendbot para
fondear en Testnet la cuenta seleccionada en Freighter. `seed:templates` añade
tres SVG de ejemplo y actualiza sus SVG semilla si ya existían, conservando las
plantillas personalizadas ya cargadas. Vuelve a subir las plantillas propias
antiguas para marcarlas con los slots nuevos.

Los archivos `storage/*.json` y las imágenes son persistencia local para el MVP,
no una base de datos compartida entre procesos o instancias. Conserva `storage/`
si quieres mantener la autoría, solicitudes y pagos demo.

## Demo paso a paso

1. Ejecuta `npm run testnet:setup` y `npm run seed:templates`; configura
   `PRICE_XLM` en `.env.local` y arranca la app con `npm run dev`.
2. En Freighter selecciona **Stellar Testnet** y fondea esa cuenta con Friendbot.
3. Sube una plantilla SVG con un nombre y wallet Stellar pública, o usa las
   plantillas de ejemplo cargadas por el seed.
4. Completa la marca (logo, paleta y estilo), los textos del post y elige la
   plantilla. Envía el formulario para crear una solicitud pendiente.
5. Selecciona esa solicitud y paga con Freighter. La transacción incluye dos
   pagos XLM, 65% a la plataforma y 35% al diseñador, y un memo hash de la
   solicitud.
6. La app consulta Horizon Testnet y verifica el éxito, el origen, las dos
   operaciones, sus importes y el memo antes de registrar el uso.
7. Revisa el último pago y el link a Stellar Expert; descarga el PNG
   personalizado. El panel del diseñador muestra usos y ganancias a partir de
   los pagos verificados en Horizon.

`npm run test:render-seed` genera además un PNG autónomo de prueba en
`test-output/`, sin ejecutar el flujo de pago.

## Registros y endpoints

- Autoría de plantillas: `storage/templates.json` (wallet, hash SHA-256 del SVG,
  identificador y fecha).
- Solicitudes y estado: `storage/post-requests.json`.
- Usos tras verificar un pago: `storage/template-uses.json`.
- Panel: `GET /api/designers/{wallet-publica}`.
- Último pago: `GET /api/payments/latest`.
- Entrega condicionada a verificación en Horizon:
  `GET /api/post-requests/{requestId}/download`.

Todos los montos se tratan con precisión de stroops. Los resúmenes consultan
Horizon para validar pagos, no confían en cantidades enviadas por el navegador.

## Slots de plantilla SVG

El diseñador define la plantilla y sus slots. Al crear el post, el sistema aplica automáticamente los colores, textos y logo de la identidad de marca mediante reglas, sin IA generativa. Cada slot usa un ID con
prefijo `slot-` y un atributo `data-slot` cuyo valor es el sufijo del ID; por
ejemplo, `id="slot-title" data-slot="title"`. Los slots mínimos al subir una
plantilla son `slot-title` y al menos uno de `slot-bg`,
`slot-color-primary`, `slot-color-secondary`, `slot-color-accent` o
`slot-color-text`. Los slots disponibles son:

- Colores: `slot-bg` (`background`), `slot-color-primary` (`primary`),
  `slot-color-secondary` (`secondary`), `slot-color-accent` (`accent`) y
  `slot-color-text` (`text`). Cada uno también lleva `data-color-role` con ese
  rol. Se asignan respectivamente el tercer color (o el primero), primero,
  segundo (o el primero), tercero (o el segundo) y cuarto (o el primero) de la
  paleta. Si el rol de texto no alcanza contraste WCAG AA de 4.5:1 respecto al
  fondo, se reemplaza por negro o blanco, el que dé mayor contraste.
- Texto: `slot-title`, `slot-slogan`, `slot-price`, `slot-occasion` y
  `slot-extra`. Son elementos `<text>` con `x`, `y`, `data-width`,
  `data-height` y `data-font-size`; `data-margin` opcional define el margen
  interior en unidades del SVG. El sistema envuelve texto y reduce el tamaño
  cuando el contenido no cabe.
- Imágenes: `slot-logo` y `slot-image` son elementos `<image>` con `x`, `y`,
  `width` y `height`. `data-margin` opcional reserva margen interior.
  `preserveAspectRatio="xMidYMid meet"` contiene el logo o la primera imagen
  del moodboard sin deformarla. `slot-image` es opcional.

Los márgenes y rectángulos útiles son responsabilidad del diseñador, expresados
en unidades del `viewBox`. Al subir el SVG, la interfaz muestra los slots
detectados. Los slots opcionales ausentes se omiten sin impedir el renderizado.
