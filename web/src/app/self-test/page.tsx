import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import SelfTestCard from "@/components/self-test/SelfTestCard";

export default function SelfTestPage() {
  return (
    <div className="flex h-screen flex-col md:flex-row">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <MainColumn>
          <SelfTestCard />
        </MainColumn>
      </div>
    </div>
  );
}
