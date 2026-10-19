import React, { useState, useEffect } from "react";

interface InputModalProps {
    isOpen: boolean;
    title: string;
    fields: { key: string; label: string; placeholder: string }[];
    onSubmit: (values: Record<string, string>) => void;
    onClose: () => void;
}

export const InputModal = ({ isOpen, title, fields, onSubmit, onClose }: InputModalProps) => {
    const [values, setValues] = useState<Record<string, string>>({});

    useEffect(() => {
        if (isOpen) {
            const initial = fields.reduce((acc, f) => ({ ...acc, [f.key]: "" }), {});
            setValues(initial);
        }
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
                        if (Object.values(values).every(v => v.trim() !== "")) {
                            onSubmit(values);
                            onClose();
                        }
                    }}>Save</button>
                </div>
            </div>
        </div>
    );
};