import type { Rich } from '../data/types';

/** Renders the rules text from the data (bold, keywords, lists, tables). */
export function RichText({ nodes }: { nodes: Rich }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <span key={i}>{n.v}</span>;
          case 'br':
            return <br key={i} />;
          case 'b':
            return (
              <b key={i}>
                <RichText nodes={n.c} />
              </b>
            );
          case 'i':
            return (
              <i key={i}>
                <RichText nodes={n.c} />
              </i>
            );
          case 'u':
            return (
              <u key={i}>
                <RichText nodes={n.c} />
              </u>
            );
          case 'kw':
            return (
              <span key={i} style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.92em' }}>
                <RichText nodes={n.c} />
              </span>
            );
          case 'p':
            return (
              <p key={i} style={{ margin: '4px 0' }}>
                <RichText nodes={n.c} />
              </p>
            );
          case 'ul':
            return (
              <ul key={i} style={{ margin: '4px 0', paddingLeft: 18 }}>
                {n.items.map((item, j) => (
                  <li key={j}>
                    <RichText nodes={item} />
                  </li>
                ))}
              </ul>
            );
          case 'table':
            return (
              <table key={i} style={{ borderCollapse: 'collapse', margin: '4px 0' }}>
                <tbody>
                  {n.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k} style={{ border: '1px solid var(--border)', padding: '2px 6px' }}>
                          <RichText nodes={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
