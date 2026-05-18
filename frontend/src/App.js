import logo from "./logo.svg";
import "./App.css";
import { supabase } from "./api/supabaseClient";
import { useEffect } from "react";
import MapPage from "./components/map/MapPage";

function App() {
  useEffect(() => {
    const test = async () => {
      const { data, error } = await supabase.from("test").select("*");
      console.log("data:", data);
      console.log("error:", error);
    };

    test();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />

        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>

        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>

      <MapPage />
    </div>
  );
}

export default App;