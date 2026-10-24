import React, { useState, useEffect, useRef } from "react";

interface InputModalProps {
    isOpen: boolean;
    title: string;
    fields: { key: string; label: string; placeholder: string }[];
    initialValues?: Record<string, string>;
    onSubmit: (values: Record<string, string>) => void;
    onClose: () => void;
}

export const InputModal = ({ isOpen, title, fields, initialValues, onSubmit, onClose }: InputModalProps) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const prevOpen = useRef(false);

    // Only reset the form when the modal transitions from CLOSED to OPEN
    useEffect(() => {
        if (isOpen && !prevOpen.current) {
            const initial = fields.reduce<Record<string, string>>((acc, field) => {
                acc[field.key] = initialValues?.[field.key] ?? "";
                return acc;
            }, {});
            setValues(initial);
        }
        prevOpen.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="soundscapes-modal-overlay" onClick={onClose}>
            <div className="soundscapes-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                {fields.map((field) => (
                    <div key={field.key} className="soundscapes-modal-field">
                        <label>{field.label}</label>
                        <input
                            type="text"
                            placeholder={field.placeholder}
                            value={values[field.key] || ""}
                            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                            autoFocus
                        />
                    </div>
                ))}
                <div className="soundscapes-modal-actions">
                    <button className="btn-cancel" onClick={onClose}>Cancel</button>
                    <button className="btn-submit" onClick={() => {
                        // 🔥 FIX: Removed the "every field must be filled" check. 
                        // We only strictly require the FIRST field (URL or Track ID)
                        if (values[fields[0].key]?.trim()) {
                            onSubmit(values);
                            onClose();
                        }
                    }}>Save</button>
                </div>
            </div>
        </div>
    );
};