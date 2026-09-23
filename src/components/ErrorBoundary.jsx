import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// The whole app used to have nothing between a page's render throwing and a
// blank white screen -- React unmounts everything above the nearest boundary
// when nothing catches the error, and with none anywhere, "nearest" meant the
// document root. Farvision Verify hit this repeatedly: something in a page's
// render (a row shaped differently than expected, a stale response after a
// slow background job) threw, and the entire app -- sidebar, header,
// everything -- vanished with no indication anything had gone wrong.
//
// This does not fix whatever throws; it makes throwing survivable. The
// content area shows a plain explanation and a way back instead of nothing,
// and the rest of the app (nav, header, the ability to go somewhere else)
// stays alive because Layout wraps only the page content in this, not itself.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Still worth a real console entry -- this is the one place left to find
    // out what actually broke, since the screen itself now says nothing more
    // specific than "something went wrong".
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // resetKey is the current route: navigating away from whatever just
    // crashed and back to a working page must not still show yesterday's
    // error, since the new page never got a chance to render at all otherwise.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <p className="text-base font-semibold text-slate-800">
          Something went wrong showing this page.
        </p>
        <p className="max-w-md text-sm text-slate-500">
          Nothing you did caused this and nothing was lost — reloading almost
          always fixes it. If it keeps happening on this same page, tell
          whoever set this app up what you were doing right before it appeared.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary mt-1 inline-flex items-center text-sm"
        >
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Reload page
        </button>
      </div>
    )
  }
}
