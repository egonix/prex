import { ConnectionBar } from "./components/ConnectionBar";
import { SessionInfoBar } from "./components/SessionInfoBar";
import { Workspace } from "./workspace/Workspace";
export function App() {
    return (<div class="flex h-full flex-col">
      <ConnectionBar />
      
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <SessionInfoBar />
        <Workspace />
      </div>
    </div>);
}
