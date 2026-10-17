import beerDark from '../assets/beer-dark.svg';
import beerLager from '../assets/beer-lager.svg';
import beerPaleAle from '../assets/beer-pale-ale.svg';
import coke from '../assets/coke.svg';
import customOrder from '../assets/custom-order.svg';
import fanta from '../assets/fanta.svg';
import qrReceiptDemo from '../assets/qr-receipt-demo.svg';
import sevenUp from '../assets/7up.svg';

// Bundled so the drink tiles work from any base path, including a
// single-file build with no /assets directory next to it.
const bundled: Record<string, string> = {
  'assets/7up.svg': sevenUp,
  'assets/beer-dark.svg': beerDark,
  'assets/beer-lager.svg': beerLager,
  'assets/beer-pale-ale.svg': beerPaleAle,
  'assets/coke.svg': coke,
  'assets/custom-order.svg': customOrder,
  'assets/fanta.svg': fanta,
  'assets/qr-receipt-demo.svg': qrReceiptDemo,
};

export function assetPath(path: string) {
  const clean = path.replace(/^\/+/, '');
  return bundled[clean] ?? `${import.meta.env.BASE_URL}${clean}`;
}
