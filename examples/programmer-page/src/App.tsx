export default function App() {
  return (
    <main className="p-8 min-h-screen bg-slate-950 text-slate-100">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <p className="mt-2 text-slate-400">Main, cards, and a Pay button. Select the button, not page padding.</p>
      <section className="mt-6 grid gap-4">
        <article className="rounded-xl bg-slate-900 p-4 shadow-sm">Card A</article>
        <article className="rounded-xl bg-slate-800 p-4 shadow-sm">Card B</article>
      </section>
      <button type="button" className="mt-6 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg">
        Pay
      </button>
    </main>
  );
}
