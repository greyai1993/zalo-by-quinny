import { useAtom, useAtomValue } from "jotai";
import Tabs from "./tabs";
import { selectedTabIndexState, tabsStateUnwrapped } from "@/state";

export default function CategoryTabs() {
  const tabs = useAtomValue(tabsStateUnwrapped);
  const [selectedIndex, setSelectedIndex] = useAtom(selectedTabIndexState);
  return (
    <Tabs
      items={tabs}
      value={tabs[selectedIndex] || tabs[0]}
      onChange={(tab) => setSelectedIndex(tabs.indexOf(tab))}
      renderLabel={(item) => item}
    />
  );
}
