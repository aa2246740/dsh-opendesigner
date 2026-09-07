export function CheckoutButton() {
  return (
    <button type="button" className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg">
      Pay now
    </button>
  );
}

export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <p className="mt-2 text-slate-400">A real React + Tailwind page OpenDesigner can open.</p>
      <div className="mt-6">
        <CheckoutButton />
      </div>
    </main>
  );
}
