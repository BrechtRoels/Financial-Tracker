import { Outlet } from "react-router-dom";
import BottomTabBar from "./BottomTabBar";
import MobileTopBar from "./MobileTopBar";

export default function MobileLayout() {
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <MobileTopBar />
      <main className="flex-1 px-4 py-4 pb-24">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}
