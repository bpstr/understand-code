export async function CheckoutPage() {
  const result = await fetch('/api/checkout', {method: 'POST'});
  const data = await result.json();
  return data.requires_login ? 'Please sign in' : 'Order received';
}

export async function AdminSettings(guest_checkout: boolean) {
  return fetch('/api/settings/checkout', {
    method: 'PUT', body: JSON.stringify({guest_checkout})
  });
}
