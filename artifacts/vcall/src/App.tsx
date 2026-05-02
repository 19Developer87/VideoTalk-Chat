import { Switch, Route, Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Lobby } from "@/pages/Lobby";
import { CallRoom } from "@/pages/CallRoom";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Lobby} />
      <Route path="/room/:roomId" component={CallRoom} />
      <Route>
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
          <p>Page not found</p>
        </div>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
