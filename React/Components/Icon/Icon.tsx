import { getIcon } from "obsidian";
import { jsx, jsxs } from "react/jsx-runtime";

const Icon = ({ name }: { name: string }) => {
    const icon = getIcon(name);

    // If the icon doesn't exist in this Obsidian version, render an empty span
    // instead of crashing. (Earlier versions of this file crashed the whole
    // React tree because they tried `new Node()`, which is an abstract class.)
    if (!icon) {
        return <span className="lucide-icon" aria-hidden="true" />;
    }

    const iconText = new XMLSerializer().serializeToString(icon);
    return (
        <span
            className="lucide-icon"
            dangerouslySetInnerHTML={{ __html: iconText }}
        />
    );
};

export default Icon;