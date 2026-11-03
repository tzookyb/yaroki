// Shown instead of a blank screen when the app crashes while rendering.
function ErrorFallback() {
  return (
    <main>
      <h1>משהו השתבש</h1>
      <p role="alert">האפליקציה נתקלה בשגיאה. נסו לטעון מחדש.</p>
      <button type="button" onClick={() => window.location.reload()}>
        טעינה מחדש
      </button>
    </main>
  )
}

export default ErrorFallback
