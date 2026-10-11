// The demo uses the test payment gateway, so Stripe is never constructed.
export default class Stripe {
  constructor() {
    throw new Error('Stripe is not available in the browser demo');
  }
}
