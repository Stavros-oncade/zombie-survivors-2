import { useRef, useState, useEffect } from 'react';
import { IRefPhaserGame, PhaserGame } from './game/PhaserGame';
import { EventBus } from './game/EventBus';
import StoreScreen from './components/StoreScreen';
import { PurchaseItem } from '@oncade/sdk';

function App()
{
    //  References to the PhaserGame component (game and scene are exposed)
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [isStoreVisible, setIsStoreVisible] = useState(false);
    const [storeItems, setStoreItems] = useState<PurchaseItem[]>([]);

    // Event emitted from the PhaserGame component
    const currentScene = () => {
        // You can add any scene-specific logic here if needed
    }

    useEffect(() => {
        // Listener for showing the store
        const showStoreHandler = (items: PurchaseItem[]) => {
            setStoreItems(items);
            setIsStoreVisible(true);
        };
        
        // Listener for hiding the store
        const hideStoreHandler = () => {
            setIsStoreVisible(false);
            setStoreItems([]); // Clear items when hiding
        };

        EventBus.on('show-store', showStoreHandler);
        EventBus.on('hide-store', hideStoreHandler);

        // Clean up listeners on component unmount
        return () => {
            EventBus.off('show-store', showStoreHandler);
            EventBus.off('hide-store', hideStoreHandler);
        };
    }, []); // Empty dependency array ensures this runs only once on mount

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} currentActiveScene={currentScene} />
            {isStoreVisible && (
                <StoreScreen items={storeItems} />
            )}
        </div>
    )
}

export default App;
